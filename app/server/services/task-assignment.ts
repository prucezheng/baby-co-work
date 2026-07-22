// 任务分配策略：包装 domain/rules.ts 的硬规则校验，
// 供 TaskOrchestrator 调用，将模型输出转为最终 assignee。

import type { FamilyMember, AiTaskDraft } from '../../src/domain/types';
import { validateAssignment } from '../../src/domain/rules';
import type { AssignmentViolation } from '../../src/domain/rules';

export interface AssignmentResult {
  assigneeId: string | null;
  reason: string;
  violation: AssignmentViolation | null;
}

/**
 * 将模型草稿中的分配信息与硬规则合并：
 * - 硬规则违反 → 转为待认领，reason 中附加违反原因
 * - 通过 → 保留模型分配的 member_id 和 reason
 */
export function resolveAssignment(
  draft: AiTaskDraft,
  members: FamilyMember[]
): AssignmentResult {
  const violation = validateAssignment(draft.assignee_member_id, draft.due_at, members);

  if (violation) {
    return {
      assigneeId: null,
      reason: `原分配无效（${violation.message}），已转为待认领`,
      violation
    };
  }

  return {
    assigneeId: draft.assignee_member_id,
    reason: draft.assignment_reason,
    violation: null
  };
}
