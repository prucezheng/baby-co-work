// 完成事件服务：包装 domain/task-events.ts 纯函数，加上持久化读写。
// 核心语义：事件不可变，撤销 = 追加 undo 事件；幂等去重、版本乐观锁。

import { randomUUID } from 'node:crypto';
import type { CompletionEvent, FamilyTaskWithSubtasks } from '../../src/domain/types';
import type { TaskRepository, EventRepository } from '../repositories/types';
import {
  assertTaskVersion,
  isDuplicateEvent,
  buildCompletionEvent,
  applyCompletionEvent,
  EventConflictError
} from '../../src/domain/task-events';

export { EventConflictError } from '../../src/domain/task-events';

export interface RecordCompletionParams {
  taskId: string;
  assigneeMemberId: string | null;
  actorMemberId: string;
  eventType: CompletionEvent['event_type'];
  completionSource?: CompletionEvent['completion_source'];
  substituteReason?: string;
  revertsEventId?: string;
  idempotencyKey: string;
}

export class TaskEventService {
  constructor(
    private taskRepo: TaskRepository,
    private eventRepo: EventRepository
  ) {}

  async recordCompletion(params: RecordCompletionParams): Promise<{
    event: CompletionEvent;
    updatedTask: FamilyTaskWithSubtasks;
  }> {
    // 1. 幂等检查
    const exists = await this.eventRepo.eventExists(params.idempotencyKey);
    if (exists) {
      throw new Error('事件已存在（idempotency_key 重复）');
    }

    // 2. 读取当前任务
    const task = await this.taskRepo.getTask(params.taskId);
    if (!task) throw new Error(`task ${params.taskId} not found`);

    // 3. 构造事件
    const event = buildCompletionEvent({
      event_id: randomUUID(),
      task_id: params.taskId,
      assignee_member_id: params.assigneeMemberId,
      actor_member_id: params.actorMemberId,
      event_type: params.eventType,
      completion_source: params.completionSource,
      substitute_reason: params.substituteReason,
      reverts_event_id: params.revertsEventId,
      occurred_at: new Date().toISOString(),
      task_version: task.version,
      idempotency_key: params.idempotencyKey
    });

    // 4. 乐观锁校验
    assertTaskVersion(task, event.task_version);

    // 5. 应用事件到任务
    const updatedTask = applyCompletionEvent(task, event);

    // 6. 持久化事件与更新后的任务
    await this.eventRepo.appendEvent(event);
    await this.taskRepo.updateTask(params.taskId, updatedTask);

    return { event, updatedTask };
  }
}
