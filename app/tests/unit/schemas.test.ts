import { describe, expect, it } from 'vitest';
import {
  achievementSchema,
  aiTaskDecompositionSchema,
  analysisSchema,
  completionEventSchema,
  createTaskInputSchema,
  familyMemberSchema,
  referenceVideoAttachmentSchema,
  subtaskSchema,
  taskSchema,
  voiceTaskInputSchema
} from '../../src/domain/schemas';

const dueAt = '2026-07-21T20:00:00.000+08:00';
const now = '2026-07-21T20:05:00.000+08:00';

describe('v1.1 domain schemas', () => {
  it('accepts a claimed family member with a PIN hash', () => {
    const member = familyMemberSchema.parse({
      member_id: 'member-dad',
      display_name: '爸爸',
      role: '爸爸',
      pin_hash: 'hash:1234',
      identity_claimed: true,
      experience: 'basic',
      available_slots: ['evening', 'night'],
      limitations: [],
      preference: 'lead'
    });

    expect(member.identity_claimed).toBe(true);
    expect(member.available_slots).toContain('evening');
  });

  it('rejects members without a PIN hash', () => {
    expect(() =>
      familyMemberSchema.parse({
        member_id: 'member-dad',
        display_name: '爸爸',
        role: '爸爸',
        identity_claimed: true
      })
    ).toThrow();
  });

  it('accepts text and voice inputs before they enter the same task schema', () => {
    expect(
      createTaskInputSchema.parse({
        request_id: 'req-1',
        family_id: 'family-1',
        creator_member_id: 'member-mom',
        input_type: 'text',
        raw_input: '爸爸今晚八点前把宝宝睡前用品准备好'
      }).input_type
    ).toBe('text');

    expect(
      voiceTaskInputSchema.parse({
        request_id: 'req-2',
        family_id: 'family-1',
        creator_member_id: 'member-grandma',
        input_type: 'voice',
        raw_input: '奶奶明天早上帮忙把换洗衣物整理一下',
        recording_duration_sec: 18,
        transcript: '奶奶明天早上帮忙把换洗衣物整理一下'
      }).recording_duration_sec
    ).toBe(18);
  });

  it('rejects voice recordings longer than 60 seconds', () => {
    expect(() =>
      voiceTaskInputSchema.parse({
        request_id: 'req-2',
        family_id: 'family-1',
        creator_member_id: 'member-grandma',
        input_type: 'voice',
        raw_input: '整理衣物',
        recording_duration_sec: 61,
        transcript: '整理衣物'
      })
    ).toThrow();
  });

  it('accepts a directly published task with knowledge notes and non-blocking safety notice', () => {
    const task = taskSchema.parse({
      task_id: 'task-1',
      title: '准备睡前用品',
      raw_input: '爸爸今晚八点前把宝宝睡前用品准备好',
      input_type: 'text',
      assignee_member_id: 'member-dad',
      due_at: dueAt,
      duration_min: 15,
      completion_criteria: '衣物、纸尿裤和湿巾放到护理台旁边',
      assignment_reason: '原始输入明确点名爸爸，且爸爸晚间可用',
      status: 'pending',
      knowledge_notes: [
        {
          note_id: 'note-1',
          source_entry_id: 'kb-sleep-setup',
          text: '检查用品是否洁净并放在伸手可及处',
          kind: 'preparation',
          conflict: false
        }
      ],
      safety_notice: '如宝宝出现异常症状，请咨询专业医护人员。',
      version: 1
    });

    expect(task.status).toBe('pending');
    expect(task.knowledge_notes).toHaveLength(1);
    expect(task).not.toHaveProperty('riskLevel');
  });

  it('allows unassigned tasks to publish as claimable tasks', () => {
    const task = taskSchema.parse({
      task_id: 'task-claimable',
      title: '整理换洗衣物',
      raw_input: '明天早上整理宝宝换洗衣物',
      input_type: 'text',
      assignee_member_id: null,
      due_at: '2026-07-22T08:00:00.000+08:00',
      duration_min: 10,
      completion_criteria: '换洗衣物放到护理台旁边',
      assignment_reason: '没有找到符合时间和限制的成员，发布为待认领',
      status: 'pending',
      knowledge_notes: [],
      safety_notice: null,
      version: 1
    });

    expect(task.assignee_member_id).toBeNull();
  });

  it('validates 2-6 AI subtasks without turning them into standalone parent tasks', () => {
    const decomposition = aiTaskDecompositionSchema.parse({
      parent_task_id: 'task-1',
      subtasks: [
        { title: '检查室温', order: 1, required: true, source: 'ai' },
        { title: '准备干净衣物', order: 2, required: true, source: 'ai' },
        { title: '摆放纸尿裤', order: 3, required: true, source: 'ai' },
        { title: '清理护理台', order: 4, required: true, source: 'ai' }
      ]
    });
    const subtasks = [
      '检查室温',
      '准备干净衣物',
      '摆放纸尿裤',
      '清理护理台'
    ].map((title, index) =>
      subtaskSchema.parse({
        subtask_id: `subtask-${index + 1}`,
        parent_task_id: 'task-1',
        title,
        order: index + 1,
        required: true,
        source: 'ai',
        completed: false
      })
    );

    expect(decomposition.subtasks).toHaveLength(4);
    expect(subtasks).toHaveLength(4);
    expect(() =>
      aiTaskDecompositionSchema.parse({
        parent_task_id: 'task-1',
        subtasks: [{ title: '只有一步', order: 1, required: true, source: 'ai' }]
      })
    ).toThrow();
    expect(() =>
      subtaskSchema.parse({
        subtask_id: 'subtask-7',
        parent_task_id: 'task-1',
        title: '多余步骤',
        order: 7,
        required: true,
        source: 'ai',
        completed: false
      })
    ).toThrow();
  });

  it('models reference video as a task attachment instead of a task source', () => {
    const attachment = referenceVideoAttachmentSchema.parse({
      attachment_id: 'attachment-1',
      task_id: 'task-1',
      file_name: 'sleep-setup.mp4',
      mime_type: 'mp4',
      file_size: 8 * 1024 * 1024,
      note: '怎么摆放用品',
      status: 'ready',
      expires_at: '2026-07-22T20:00:00.000+08:00'
    });

    expect(attachment.task_id).toBe('task-1');
    expect(attachment).not.toHaveProperty('videoId');
  });

  it('records the actual actor when someone completes a task', () => {
    const event = completionEventSchema.parse({
      event_id: 'event-1',
      task_id: 'task-1',
      assignee_member_id: 'member-dad',
      actor_member_id: 'member-grandma',
      event_type: 'completed',
      completion_source: 'substitute',
      substitute_reason: '爸爸临时加班',
      occurred_at: now,
      task_version: 3,
      idempotency_key: 'complete-task-1-v3'
    });

    expect(event.actor_member_id).toBe('member-grandma');
    expect(event.assignee_member_id).toBe('member-dad');
  });

  it('requires completion_source for completed events', () => {
    expect(() =>
      completionEventSchema.parse({
        event_id: 'event-1',
        task_id: 'task-1',
        assignee_member_id: 'member-dad',
        actor_member_id: 'member-dad',
        event_type: 'completed',
        occurred_at: now,
        task_version: 1,
        idempotency_key: 'complete-task-1-v1'
      })
    ).toThrow();
  });

  it('requires achievement unlocks to point back to source events', () => {
    const achievement = achievementSchema.parse({
      achievement_id: 'first-handoff',
      scope: 'member',
      owner_id: 'member-dad',
      unlocked_at: now,
      source_event_ids: ['event-1']
    });

    expect(achievement.scope).toBe('member');
  });
});

describe('legacy video analysis schema', () => {
  it('still accepts a v1.0 analysis for the experimental analyze path', () => {
    const analysis = analysisSchema.parse({
      videoId: 'video-1',
      topic: '睡前护理',
      applicableScene: '睡前',
      supplies: [],
      cautions: [],
      uncertainties: [],
      steps: [
        {
          id: 'step-1',
          order: 1,
          title: '准备用品',
          instruction: '将用品放在护理台旁边',
          startSec: 1,
          endSec: 8,
          supplies: [],
          caution: '',
          riskLevel: 'low',
          userConfirmed: false
        }
      ]
    });

    expect(analysis.steps).toHaveLength(1);
  });
});
