import { describe, expect, it } from 'vitest';
import {
  applyMemberUnavailablePlan,
  planMemberUnavailable,
  revertMemberUnavailablePlan
} from '../../src/domain/adjustment';
import type { FamilyTask } from '../../src/domain/types';

function makeTask(overrides: Partial<FamilyTask>): FamilyTask {
  return {
    task_id: 'task-x',
    title: '任务',
    raw_input: '原始输入内容',
    input_type: 'text',
    assignee_member_id: 'dad-1',
    due_at: null,
    duration_min: 10,
    completion_criteria: '完成标准',
    assignment_reason: '分配原因',
    status: 'pending',
    knowledge_notes: [],
    safety_notice: null,
    manually_assigned: false,
    locked_by_user: false,
    version: 1,
    ...overrides
  };
}

// 场景：爸爸今晚加班（不可用）。他名下 1 项已完成、1 项锁定、1 项人工改派、1 项普通待办；
// 妈妈名下 1 项待办。只有爸爸的普通待办应被转为待认领。
const tasks: FamilyTask[] = [
  makeTask({ task_id: 't-completed', status: 'completed' }),
  makeTask({ task_id: 't-locked', locked_by_user: true }),
  makeTask({ task_id: 't-manual', manually_assigned: true }),
  makeTask({ task_id: 't-pending' }),
  makeTask({ task_id: 't-in-progress', status: 'in_progress' }),
  makeTask({ task_id: 't-mom', assignee_member_id: 'mom-1' })
];

describe('planMemberUnavailable', () => {
  it('only adjusts the member\'s unfinished unprotected tasks', () => {
    const plan = planMemberUnavailable('dad-1', tasks);
    const adjustedIds = plan.adjustments.map((a) => a.taskId).sort();
    expect(adjustedIds).toEqual(['t-in-progress', 't-pending']);
    expect(plan.protectedTaskIds.sort()).toEqual(['t-locked', 't-manual']);
  });

  it('records before/after snapshots for undo', () => {
    const plan = planMemberUnavailable('dad-1', tasks);
    const inProgress = plan.adjustments.find((a) => a.taskId === 't-in-progress');
    expect(inProgress?.before).toEqual({ assigneeMemberId: 'dad-1', status: 'in_progress' });
    expect(inProgress?.after).toEqual({ assigneeMemberId: null, status: 'pending' });
  });
});

describe('applyMemberUnavailablePlan', () => {
  it('sets adjusted tasks to 待认领 and leaves everything else untouched', () => {
    const plan = planMemberUnavailable('dad-1', tasks);
    const result = applyMemberUnavailablePlan(tasks, plan);
    const byId = new Map(result.map((t) => [t.task_id, t]));

    expect(byId.get('t-pending')?.assignee_member_id).toBeNull();
    expect(byId.get('t-in-progress')?.status).toBe('pending');
    expect(byId.get('t-completed')?.status).toBe('completed');
    expect(byId.get('t-completed')?.assignee_member_id).toBe('dad-1');
    expect(byId.get('t-locked')?.assignee_member_id).toBe('dad-1');
    expect(byId.get('t-manual')?.assignee_member_id).toBe('dad-1');
    expect(byId.get('t-mom')?.assignee_member_id).toBe('mom-1');
  });

  it('does not mutate the input array', () => {
    const plan = planMemberUnavailable('dad-1', tasks);
    applyMemberUnavailablePlan(tasks, plan);
    expect(tasks.find((t) => t.task_id === 't-pending')?.assignee_member_id).toBe('dad-1');
  });
});

describe('revertMemberUnavailablePlan', () => {
  it('restores the exact before state', () => {
    const plan = planMemberUnavailable('dad-1', tasks);
    const applied = applyMemberUnavailablePlan(tasks, plan);
    const reverted = revertMemberUnavailablePlan(applied, plan);
    const byId = new Map(reverted.map((t) => [t.task_id, t]));

    expect(byId.get('t-pending')?.assignee_member_id).toBe('dad-1');
    expect(byId.get('t-in-progress')?.status).toBe('in_progress');
  });
});
