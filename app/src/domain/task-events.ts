// 完成事件账本规则（PRD v1.1 §6.7 / 实施计划 v1.1 Task 9）
// 核心语义：事件不可变，撤销 = 追加一条 undo 事件而非删除历史；
// 幂等键去重、task_version 乐观锁；代完成必须带原因。

import { completionEventSchema } from './schemas';
import type { CompletionEvent, FamilyTask } from './types';

export class EventConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor(taskId: string, expected: number, actual: number) {
    super(`任务 ${taskId} 版本冲突：期望 ${expected}，实际 ${actual}`);
    this.name = 'EventConflictError';
  }
}

// 乐观锁：事件携带的 task_version 必须与当前任务版本一致
export function assertTaskVersion(task: Pick<FamilyTask, 'task_id' | 'version'>, eventVersion: number): void {
  if (task.version !== eventVersion) {
    throw new EventConflictError(task.task_id, task.version, eventVersion);
  }
}

// 幂等：同一 idempotency_key 的事件只生效一次
export function isDuplicateEvent(events: CompletionEvent[], idempotencyKey: string): boolean {
  return events.some((event) => event.idempotency_key === idempotencyKey);
}

// 构造并校验事件（schema 内含：completed 必须有 source、代完成必须有原因、undo 必须有 reverts_event_id）
export function buildCompletionEvent(input: unknown): CompletionEvent {
  return completionEventSchema.parse(input);
}

// 把事件应用到任务状态，返回新任务对象（version 递增供下一次乐观锁校验）
export function applyCompletionEvent<T extends FamilyTask>(task: T, event: CompletionEvent): T {
  const nextVersion = task.version + 1;
  switch (event.event_type) {
    case 'completed':
      return { ...task, status: 'completed', version: nextVersion };
    case 'undo':
      // 撤销完成：任务回到待执行；历史事件保留在账本中
      return { ...task, status: 'pending', version: nextVersion };
    case 'skipped':
      return { ...task, status: 'skipped', version: nextVersion };
    case 'reassigned':
      // 人工改派：打上 manually_assigned 标记，后续动态调整不得覆盖
      return {
        ...task,
        assignee_member_id: event.assignee_member_id,
        manually_assigned: true,
        version: nextVersion
      };
  }
}
