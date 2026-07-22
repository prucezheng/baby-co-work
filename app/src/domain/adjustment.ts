// 动态调整的确定性规则（PRD v1.1 §6.10 / 实施计划 v1.1 Task 9）
// 纯函数、不依赖存储：成员不可用 → 只把其"未完成、未锁定、非人工改派"的任务
// 转为待认领；completed / locked_by_user / manually_assigned 的任务绝不动。
// 计划对象携带 before/after 快照，撤销时按快照精确回滚。

import type { FamilyTask } from './types';

export type AdjustableTask = Pick<
  FamilyTask,
  'task_id' | 'assignee_member_id' | 'status' | 'locked_by_user' | 'manually_assigned'
>;

export interface TaskAdjustment {
  taskId: string;
  before: { assigneeMemberId: string | null; status: FamilyTask['status'] };
  after: { assigneeMemberId: string | null; status: FamilyTask['status'] };
}

export interface MemberUnavailablePlan {
  memberId: string;
  adjustments: TaskAdjustment[];
  /** 分配给该成员但因锁定/人工改派而被保护的任务 */
  protectedTaskIds: string[];
}

// 只有这些状态允许被动态调整；completed / skipped / cancelled 视为已终结
const ADJUSTABLE_STATUSES = new Set<FamilyTask['status']>(['pending', 'in_progress', 'affected']);

export function planMemberUnavailable(
  memberId: string,
  tasks: AdjustableTask[]
): MemberUnavailablePlan {
  const adjustments: TaskAdjustment[] = [];
  const protectedTaskIds: string[] = [];

  for (const task of tasks) {
    if (task.assignee_member_id !== memberId) continue;
    if (!ADJUSTABLE_STATUSES.has(task.status)) continue;
    if (task.locked_by_user || task.manually_assigned) {
      protectedTaskIds.push(task.task_id);
      continue;
    }
    adjustments.push({
      taskId: task.task_id,
      before: { assigneeMemberId: task.assignee_member_id, status: task.status },
      after: { assigneeMemberId: null, status: 'pending' }
    });
  }

  return { memberId, adjustments, protectedTaskIds };
}

// 应用调整：返回新数组，不修改入参
export function applyMemberUnavailablePlan<T extends AdjustableTask>(
  tasks: T[],
  plan: MemberUnavailablePlan
): T[] {
  const byTaskId = new Map(plan.adjustments.map((a) => [a.taskId, a]));
  return tasks.map((task) => {
    const adjustment = byTaskId.get(task.task_id);
    if (!adjustment) return task;
    return {
      ...task,
      assignee_member_id: adjustment.after.assigneeMemberId,
      status: adjustment.after.status
    };
  });
}

// 撤销调整：按 before 快照精确回滚（对应"先应用 + 可撤销"的撤销侧）
export function revertMemberUnavailablePlan<T extends AdjustableTask>(
  tasks: T[],
  plan: MemberUnavailablePlan
): T[] {
  const byTaskId = new Map(plan.adjustments.map((a) => [a.taskId, a]));
  return tasks.map((task) => {
    const adjustment = byTaskId.get(task.task_id);
    if (!adjustment) return task;
    return {
      ...task,
      assignee_member_id: adjustment.before.assigneeMemberId,
      status: adjustment.before.status
    };
  });
}
