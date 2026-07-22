// 任务编排器：文字/语音输入 → 知识增强 → 模型生成 → 硬规则分配 → 直接发布。
// 这是任务创建的主入口，协调 knowledge-base、task-model、task-assignment 和持久化。

import { randomUUID } from 'node:crypto';
import type { ArkClient } from './ark-client';
import type { FamilyMember, FamilyTaskWithSubtasks, CreateTaskInput } from '../../src/domain/types';
import type { TaskRepository } from '../repositories/types';
import { generateTaskDraft } from './task-model';
import { resolveAssignment } from './task-assignment';
import { enhanceWithKnowledge } from './knowledge-base';
import { containsMedicalRisk } from './safety';
import type { TaskDraftContext } from '../prompts';

const MEDICAL_SAFETY_NOTICE = '这部分可能涉及医疗判断。请暂停执行，并咨询儿科医生或专业医护人员。';

export interface CreateTaskRequest {
  input: CreateTaskInput;
  members: FamilyMember[];
  currentTime?: string;
  dailyLoadMinutes?: Record<string, number>;
}

export interface CreateTaskResult {
  task: FamilyTaskWithSubtasks;
  knowledgeNotesCount: number;
  medicalBlocked: boolean;
}

export class TaskOrchestrator {
  constructor(
    private arkClient: ArkClient,
    private taskRepo: TaskRepository
  ) {}

  async createTask(req: CreateTaskRequest): Promise<CreateTaskResult> {
    const { input, members } = req;
    const currentTime = req.currentTime ?? new Date().toISOString();
    const dailyLoadMinutes = req.dailyLoadMinutes ?? {};

    // 1. 知识库增强
    const enhancement = await enhanceWithKnowledge(input.raw_input, '');

    // 2. 调用模型生成草稿
    const draftCtx: TaskDraftContext = {
      rawInput: input.raw_input,
      members: members.map((m) => ({
        member_id: m.member_id,
        display_name: m.display_name,
        role: m.role,
        experience: m.experience,
        available_slots: m.available_slots,
        limitations: m.limitations,
        preference: m.preference,
        temporary_unavailable: m.temporary_unavailable
      })),
      currentTime,
      dailyLoadMinutes
    };

    const draft = await generateTaskDraft(this.arkClient, draftCtx);

    // 3. 硬规则校验分配
    const assignment = resolveAssignment(draft, members);

    // 4. 医疗安全检测
    const medical =
      containsMedicalRisk(input.raw_input) ||
      containsMedicalRisk(draft.title) ||
      containsMedicalRisk(draft.completion_criteria);

    const subtasks = medical ? [] : draft.subtasks;
    const safetyNotice = medical
      ? (draft.safety_notice ?? MEDICAL_SAFETY_NOTICE)
      : draft.safety_notice;

    // 5. 组装完整任务对象
    const taskId = randomUUID();
    const task: FamilyTaskWithSubtasks = {
      task_id: taskId,
      title: draft.title,
      raw_input: input.raw_input,
      input_type: input.input_type,
      assignee_member_id: assignment.assigneeId,
      due_at: draft.due_at,
      duration_min: draft.duration_min,
      completion_criteria: draft.completion_criteria,
      assignment_reason: assignment.reason,
      status: 'pending',
      knowledge_notes: enhancement.notes.map((n, i) => ({
        note_id: randomUUID().slice(0, 12),
        source_entry_id: n.sourceEntryId,
        text: n.text,
        kind: n.kind,
        conflict: false
      })),
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

    // 6. 持久化
    await this.taskRepo.createTask(task);

    return {
      task,
      knowledgeNotesCount: enhancement.notes.length,
      medicalBlocked: medical
    };
  }
}
