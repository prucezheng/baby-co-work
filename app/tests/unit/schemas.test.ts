import { describe, expect, it } from 'vitest';
import { analysisSchema, memberSchema, taskSchema } from '../../src/domain/schemas';

describe('domain schemas', () => {
  it('rejects medical steps as executable tasks', () => {
    expect(() =>
      taskSchema.parse({
        id: 'task-1',
        title: '服用药物',
        sourceStepId: 'step-1',
        assigneeId: 'member-1',
        collaboratorIds: [],
        timeSlot: 'night',
        durationMin: 10,
        assignmentReason: '按视频执行',
        status: 'pending',
        lockedByUser: false,
        riskLevel: 'medical',
        version: 1
      })
    ).toThrow();
  });

  it('accepts a confirmed low-risk analysis', () => {
    const value = analysisSchema.parse({
      videoId: 'video-1',
      topic: '睡前用品准备',
      applicableScene: '睡前护理',
      supplies: ['干净衣物'],
      cautions: ['保持用品清洁'],
      uncertainties: [],
      steps: [
        {
          id: 'step-1',
          order: 1,
          title: '准备用品',
          instruction: '将用品放在伸手可及处',
          startSec: 10,
          endSec: 25,
          supplies: ['干净衣物'],
          caution: '',
          riskLevel: 'low',
          userConfirmed: true
        }
      ]
    });
    expect(value.steps).toHaveLength(1);
  });

  it('rejects members without a display name', () => {
    expect(() =>
      memberSchema.parse({
        id: 'm1',
        displayName: '',
        role: '爸爸',
        experience: 'beginner',
        availableSlots: ['night'],
        limitations: [],
        preference: 'assist',
        temporaryUnavailable: false
      })
    ).toThrow();
  });
});
