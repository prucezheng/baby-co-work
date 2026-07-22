import { describe, expect, it } from 'vitest';
import {
  applyCompletionEvent,
  assertTaskVersion,
  buildCompletionEvent,
  EventConflictError,
  isDuplicateEvent
} from '../../src/domain/task-events';
import type { CompletionEvent, FamilyTask } from '../../src/domain/types';

const baseEvent = {
  event_id: 'evt-1',
  task_id: 'task-1',
  assignee_member_id: 'dad-1',
  actor_member_id: 'dad-1',
  occurred_at: '2026-07-21T20:00:00+08:00',
  task_version: 1,
  idempotency_key: 'req-1'
};

function makeTask(overrides: Partial<FamilyTask> = {}): FamilyTask {
  return {
    task_id: 'task-1',
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

describe('buildCompletionEvent', () => {
  it('requires completion_source for completed events', () => {
    expect(() => buildCompletionEvent({ ...baseEvent, event_type: 'completed' })).toThrow();
  });

  it('requires a reason for substitute completions', () => {
    expect(() =>
      buildCompletionEvent({ ...baseEvent, event_type: 'completed', completion_source: 'substitute' })
    ).toThrow();
  });

  it('requires reverts_event_id for undo events', () => {
    expect(() => buildCompletionEvent({ ...baseEvent, event_type: 'undo' })).toThrow();
  });

  it('accepts a valid substitute completion', () => {
    const event = buildCompletionEvent({
      ...baseEvent,
      event_type: 'completed',
      completion_source: 'substitute',
      actor_member_id: 'mom-1',
      substitute_reason: '爸爸临时加班'
    });
    expect(event.actor_member_id).toBe('mom-1');
  });
});

describe('assertTaskVersion', () => {
  it('throws VERSION_CONFLICT on stale versions', () => {
    expect(() => assertTaskVersion(makeTask({ version: 3 }), 2)).toThrow(EventConflictError);
  });

  it('passes on matching versions', () => {
    expect(() => assertTaskVersion(makeTask({ version: 3 }), 3)).not.toThrow();
  });
});

describe('isDuplicateEvent', () => {
  it('detects repeated idempotency keys', () => {
    const event = buildCompletionEvent({
      ...baseEvent,
      event_type: 'completed',
      completion_source: 'self'
    });
    expect(isDuplicateEvent([event], 'req-1')).toBe(true);
    expect(isDuplicateEvent([event], 'req-2')).toBe(false);
  });
});

describe('applyCompletionEvent', () => {
  it('completes a task and bumps the version', () => {
    const event = buildCompletionEvent({
      ...baseEvent,
      event_type: 'completed',
      completion_source: 'self'
    });
    const next = applyCompletionEvent(makeTask(), event);
    expect(next.status).toBe('completed');
    expect(next.version).toBe(2);
  });

  it('undo appends a new state instead of deleting history', () => {
    const completed = applyCompletionEvent(
      makeTask(),
      buildCompletionEvent({ ...baseEvent, event_type: 'completed', completion_source: 'self' })
    );
    const undo = buildCompletionEvent({
      ...baseEvent,
      event_id: 'evt-2',
      event_type: 'undo',
      reverts_event_id: 'evt-1',
      task_version: 2,
      idempotency_key: 'req-2'
    });
    const reverted = applyCompletionEvent(completed, undo);
    expect(reverted.status).toBe('pending');
    expect(reverted.version).toBe(3);
  });

  it('reassigned marks the task as manually assigned', () => {
    const event = buildCompletionEvent({
      ...baseEvent,
      event_type: 'reassigned',
      assignee_member_id: 'mom-1'
    });
    const next = applyCompletionEvent(makeTask(), event);
    expect(next.assignee_member_id).toBe('mom-1');
    expect(next.manually_assigned).toBe(true);
  });
});
