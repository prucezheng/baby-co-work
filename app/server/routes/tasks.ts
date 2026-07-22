// 任务路由：文字输入创建任务 + 完成事件记录。
// 业务逻辑已抽离到 TaskOrchestrator / TaskEventService，路由只做参数校验和 HTTP 响应。

import { Router } from 'express';
import { z } from 'zod';
import type { TaskOrchestrator } from '../services/task-orchestrator';
import type { TaskEventService } from '../services/task-events';
import type { TaskRepository, FamilyRepository } from '../repositories/types';
import { createTaskInputSchema, familyMemberSchema } from '../../src/domain/schemas';
import { ArkError } from '../services/ark-client';
import { ModelOutputError } from '../services/model-json';

export const createTaskRequestSchema = z.object({
  request: createTaskInputSchema,
  members: z.array(familyMemberSchema).min(1).max(8),
  current_time: z.string().datetime({ offset: true }).optional(),
  daily_load_minutes: z.record(z.string(), z.number().int().min(0)).optional()
});

export type CreateTaskRequestBody = z.infer<typeof createTaskRequestSchema>;

const completionSchema = z.object({
  task_id: z.string().trim().min(1),
  actor_member_id: z.string().trim().min(1),
  event_type: z.enum(['completed', 'undo', 'skipped', 'reassigned']),
  completion_source: z.enum(['self', 'substitute', 'automatic']).optional(),
  substitute_reason: z.string().trim().min(1).max(120).optional(),
  reverts_event_id: z.string().trim().min(1).optional(),
  assignee_member_id: z.string().trim().min(1).nullable().optional(),
  idempotency_key: z.string().trim().min(1).max(120)
});

export function createTasksRouter(
  orchestrator: TaskOrchestrator,
  taskEventService: TaskEventService,
  taskRepo: TaskRepository,
  _familyRepo: FamilyRepository
): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = createTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合任务创建规范' });
      return;
    }

    const { request, members, current_time, daily_load_minutes } = parsed.data;

    try {
      const result = await orchestrator.createTask({
        input: request,
        members,
        currentTime: current_time,
        dailyLoadMinutes: daily_load_minutes
      });

      res.status(201).json({ task: result.task });
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
      console.error('[tasks] create error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  router.post('/:taskId/complete', async (req, res) => {
    const parsed = completionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合完成事件规范' });
      return;
    }

    const {
      task_id,
      actor_member_id,
      event_type,
      completion_source,
      substitute_reason,
      reverts_event_id,
      assignee_member_id,
      idempotency_key
    } = parsed.data;

    try {
      const { event, updatedTask } = await taskEventService.recordCompletion({
        taskId: task_id,
        assigneeMemberId: assignee_member_id ?? null,
        actorMemberId: actor_member_id,
        eventType: event_type,
        completionSource: completion_source,
        substituteReason: substitute_reason,
        revertsEventId: reverts_event_id,
        idempotencyKey: idempotency_key
      });

      res.json({ event, task: updatedTask });
    } catch (error) {
      if (error instanceof Error && error.message.includes('已存在')) {
        res.status(409).json({ code: 'DUPLICATE_EVENT', message: error.message });
        return;
      }
      if (error instanceof Error && error.name === 'EventConflictError') {
        res.status(409).json({ code: 'VERSION_CONFLICT', message: error.message });
        return;
      }
      console.error('[tasks] complete error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const familyId = req.query.family_id as string | undefined;
      if (!familyId) {
        res.status(400).json({ code: 'MISSING_PARAM', message: '缺少 family_id 参数' });
        return;
      }

      if (req.session && req.session.familyId !== familyId) {
        res.status(403).json({ code: 'FORBIDDEN', message: '无权访问该家庭' });
        return;
      }

      const tasks = await taskRepo.listTasksByFamily(familyId);
      res.json({ tasks });
    } catch (error) {
      console.error('[tasks] list error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  router.get('/:taskId', async (req, res) => {
    try {
      const task = await taskRepo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' });
        return;
      }
      res.json({ task });
    } catch (error) {
      console.error('[tasks] get error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
