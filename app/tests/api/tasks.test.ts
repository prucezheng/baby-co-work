import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { ArkError } from '../../server/services/ark-client';
import type { ArkClient } from '../../server/services/ark-client';
import type { FamilyMember } from '../../src/domain/types';
import fixture from '../fixtures/task-draft.json';

function fakeClient(queue: Array<string | Error>): ArkClient & { chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('fake client queue exhausted');
    if (next instanceof Error) throw next;
    return next;
  });
  return { chat };
}

const members: FamilyMember[] = [
  {
    member_id: 'dad-1',
    display_name: '爸爸',
    role: '爸爸',
    pin_hash: 'hash',
    identity_claimed: true,
    experience: 'basic',
    available_slots: ['evening', 'night'],
    limitations: [],
    preference: 'assist',
    temporary_unavailable: false
  },
  {
    member_id: 'grandma-1',
    display_name: '奶奶',
    role: '奶奶',
    pin_hash: 'hash',
    identity_claimed: true,
    experience: 'experienced',
    available_slots: ['morning', 'daytime'],
    limitations: ['不可夜间照护'],
    preference: 'simple',
    temporary_unavailable: false
  }
];

const validBody = {
  request: {
    request_id: 'req-1',
    family_id: 'family-1',
    creator_member_id: 'mom-1',
    input_type: 'text',
    raw_input: '今晚睡前帮宝宝准备好换洗衣物和纸尿裤'
  },
  members,
  current_time: '2026-07-21T18:00:00+08:00'
};

describe('POST /api/tasks', () => {
  it('publishes a task with assignee and subtasks directly', async () => {
    const client = fakeClient([JSON.stringify(fixture)]);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(validBody);

    expect(response.status).toBe(201);
    const task = response.body.task;
    expect(task.status).toBe('pending');
    expect(task.assignee_member_id).toBe('dad-1');
    expect(task.subtasks).toHaveLength(3);
    expect(task.subtasks[0].completed).toBe(false);
    expect(task.assignment_reason).not.toMatch(/AI 推荐/);
  });

  it('falls back to 待认领 when the model assigns an unknown member', async () => {
    const badDraft = { ...fixture, assignee_member_id: 'ghost-member' };
    const client = fakeClient([JSON.stringify(badDraft)]);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.task.assignee_member_id).toBeNull();
    expect(response.body.task.assignment_reason).toContain('待认领');
  });

  it('falls back to 待认领 when the assignment violates night limitations', async () => {
    const nightDraft = { ...fixture, assignee_member_id: 'grandma-1', due_at: '2026-07-21T23:30:00+08:00' };
    const client = fakeClient([JSON.stringify(nightDraft)]);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.task.assignee_member_id).toBeNull();
  });

  it('publishes medical content with safety notice but no expanded subtasks', async () => {
    const medicalBody = {
      ...validBody,
      request: { ...validBody.request, raw_input: '宝宝发烧到38.5度要不要喂退烧药' }
    };
    const medicalDraft = { ...fixture, title: '宝宝发热处理', safety_notice: null };
    const client = fakeClient([JSON.stringify(medicalDraft)]);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(medicalBody);

    expect(response.status).toBe(201);
    expect(response.body.task.status).toBe('pending');
    expect(response.body.task.subtasks).toHaveLength(0);
    expect(response.body.task.safety_notice).toContain('医护');
  });

  it('repairs invalid model output exactly once', async () => {
    const client = fakeClient(['not json', JSON.stringify(fixture)]);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(validBody);

    expect(response.status).toBe(201);
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('returns INVALID_MODEL_OUTPUT when repair also fails', async () => {
    const client = fakeClient(['bad', 'worse']);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(validBody);

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('INVALID_MODEL_OUTPUT');
  });

  it('maps model timeout to 504', async () => {
    const client = fakeClient([new ArkError('ARK_TIMEOUT', 'timeout')]);
    const response = await request(createApp({ arkClient: client })).post('/api/tasks').send(validBody);

    expect(response.status).toBe(504);
  });

  it('rejects invalid request bodies without calling the model', async () => {
    const client = fakeClient([]);
    const response = await request(createApp({ arkClient: client }))
      .post('/api/tasks')
      .send({ request: { raw_input: 'x' } });

    expect(response.status).toBe(400);
    expect(client.chat).not.toHaveBeenCalled();
  });
});
