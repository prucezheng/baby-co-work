import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { buildRepairPrompt, buildTaskDraftPrompt } from '../prompts';
import type { ArkClient } from '../services/ark-client';
import { ArkError } from '../services/ark-client';
import { ModelOutputError, parseTaskDraftOutput } from '../services/model-json';
import { containsMedicalRisk } from '../services/safety';
import { createTaskInputSchema, familyMemberSchema } from '../../src/domain/schemas';
import type { FamilyTaskWithSubtasks } from '../../src/domain/types';
import { validateAssignment } from '../../src/domain/rules';

const MEDICAL_SAFETY_NOTICE = '这部分可能涉及医疗判断。请暂停执行，并咨询儿科医生或专业医护人员。';

const createTaskRequestSchema = z.object({
  request: createTaskInputSchema,
  members: z.array(familyMemberSchema).min(1).max(8),
  current_time: z.string().datetime({ offset: true }).optional(),
  daily_load_minutes: z.record(z.string(), z.number().int().min(0)).optional()
});

export function createTasksRouter(arkClient: ArkClient): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = createTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合任务创建规范' });
      return;
    }

    const { request, members, daily_load_minutes } = parsed.data;
    const currentTime = parsed.data.current_time ?? new Date().toISOString();

    try {
      const prompt = buildTaskDraftPrompt({
        rawInput: request.raw_input,
        members,
        currentTime,
        dailyLoadMinutes: daily_load_minutes
      });

      const raw = await arkClient.chat([{ type: 'text', text: prompt }]);

      let draft;
      try {
        draft = parseTaskDraftOutput(raw);
      } catch (firstError) {
        if (!(firstError instanceof ModelOutputError)) throw firstError;
        const repaired = await arkClient.chat([
          { type: 'text', text: buildRepairPrompt(raw, firstError.issues) }
        ]);
        draft = parseTaskDraftOutput(repaired);
      }

      // 确定性硬规则：模型分配违反底线时转为待认领，不强行接受
      const violation = validateAssignment(draft.assignee_member_id, draft.due_at, members);
      const assigneeId = violation ? null : draft.assignee_member_id;
      const assignmentReason = violation
        ? `原分配无效（${violation.message}），已转为待认领`
        : draft.assignment_reason;

      // 医疗内容非阻断处理（PRD v1.1 §6.3）：照常发布，但不扩写医疗子步骤，追加就医提示
      const medical =
        containsMedicalRisk(request.raw_input) ||
        containsMedicalRisk(draft.title) ||
        containsMedicalRisk(draft.completion_criteria);
      const subtasks = medical ? [] : draft.subtasks;
      const safetyNotice = medical ? (draft.safety_notice ?? MEDICAL_SAFETY_NOTICE) : draft.safety_notice;

      const taskId = randomUUID();
      const task: FamilyTaskWithSubtasks = {
        task_id: taskId,
        title: draft.title,
        raw_input: request.raw_input,
        input_type: request.input_type,
        assignee_member_id: assigneeId,
        due_at: draft.due_at,
        duration_min: draft.duration_min,
        completion_criteria: draft.completion_criteria,
        assignment_reason: assignmentReason,
        status: 'pending',
        knowledge_notes: draft.knowledge_notes,
        safety_notice: safetyNotice,
        manually_assigned: false,
        locked_by_user: false,
        version: 1,
        subtasks: subtasks.map((s) => ({
          subtask_id: randomUUID(),
          parent_task_id: taskId,
          title: s.title,
          order: s.order,
          required: s.required,
          source: s.source,
          completed: false
        }))
      };

      res.status(201).json({ task });
    } catch (error) {
      if (error instanceof ArkError) {
        const status = error.code === 'ARK_TIMEOUT' ? 504 : 503;
        res.status(status).json({ code: error.code, message: error.message });
        return;
      }
      if (error instanceof ModelOutputError) {
        res.status(502).json({ code: 'INVALID_MODEL_OUTPUT', message: error.message });
        return;
      }
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
