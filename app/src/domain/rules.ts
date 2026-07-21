// 分配的确定性硬规则（PRD v1.1 §6.5）：
// 模型负责软匹配（经验/负载/偏好），这里负责不可逾越的底线——
// 负责人必须存在、临时不可用不可派、明确的时间限制不可违反。
// 规则保持保守：只拦截确定错误，软约束交给模型。

import type { FamilyMember } from './types';

export interface AssignmentViolation {
  code: 'UNKNOWN_MEMBER' | 'MEMBER_UNAVAILABLE' | 'LIMITATION_CONFLICT';
  message: string;
}

export type TimeSlot = 'morning' | 'daytime' | 'evening' | 'night';

const NIGHT_LIMITATION_PATTERN = /夜间|夜晚|熬夜|晚上/;

export function timeSlotFromIso(iso: string): TimeSlot {
  const hour = new Date(iso).getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'daytime';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

// 返回 null 表示分配合法；assigneeId 为 null 是合法的"待认领"状态
export function validateAssignment(
  assigneeId: string | null,
  dueAt: string | null,
  members: FamilyMember[]
): AssignmentViolation | null {
  if (assigneeId === null) return null;

  const member = members.find((m) => m.member_id === assigneeId);
  if (!member) {
    return { code: 'UNKNOWN_MEMBER', message: '负责人不在家庭成员列表中' };
  }
  if (member.temporary_unavailable) {
    return { code: 'MEMBER_UNAVAILABLE', message: `${member.display_name}当前不可用` };
  }
  if (dueAt !== null) {
    const slot = timeSlotFromIso(dueAt);
    if (slot === 'night' && member.limitations.some((l) => NIGHT_LIMITATION_PATTERN.test(l))) {
      return { code: 'LIMITATION_CONFLICT', message: `${member.display_name}不可夜间照护` };
    }
  }
  return null;
}
