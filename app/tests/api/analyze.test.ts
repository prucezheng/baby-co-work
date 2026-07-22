import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { ArkError } from '../../server/services/ark-client';
import type { ArkClient } from '../../server/services/ark-client';
import fixture from '../fixtures/analysis.json';

function fakeClient(queue: Array<string | Error>): ArkClient & { chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('fake client queue exhausted');
    if (next instanceof Error) throw next;
    return next;
  });
  return { chat };
}

const validRaw = JSON.stringify(fixture);

describe('POST /api/analyze', () => {
  it('returns a validated analysis for fenced JSON output', async () => {
    const client = fakeClient([` \`\`\`json\n${validRaw}\n\`\`\` `]);
    const response = await request(createApp({ arkClient: client, skipAuth: true }))
      .post('/api/analyze')
      .send({ mediaUrl: 'https://example.com/care.mp4', videoId: 'v1' });

    expect(response.status).toBe(200);
    expect(response.body.analysis.topic).toBe('新生儿睡前护理流程');
    expect(response.body.analysis.videoId).toBe('v1');
    expect(response.body.analysis.steps).toHaveLength(3);
  });

  it('upgrades medicine steps to medical risk', async () => {
    const withMedicine = JSON.parse(validRaw) as typeof fixture;
    withMedicine.steps[0].title = '按剂量喂药';
    withMedicine.steps[0].riskLevel = 'low';
    const client = fakeClient([JSON.stringify(withMedicine)]);

    const response = await request(createApp({ arkClient: client, skipAuth: true }))
      .post('/api/analyze')
      .send({ mediaUrl: 'https://example.com/care.mp4' });

    expect(response.status).toBe(200);
    expect(response.body.analysis.steps[0].riskLevel).toBe('medical');
  });

  it('repairs invalid output exactly once', async () => {
    const client = fakeClient(['not json at all', validRaw]);
    const response = await request(createApp({ arkClient: client, skipAuth: true }))
      .post('/api/analyze')
      .send({ mediaUrl: 'https://example.com/care.mp4' });

    expect(response.status).toBe(200);
    expect(response.body.repaired).toBe(true);
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('returns INVALID_MODEL_OUTPUT when repair also fails', async () => {
    const client = fakeClient(['garbage', 'still garbage']);
    const response = await request(createApp({ arkClient: client, skipAuth: true }))
      .post('/api/analyze')
      .send({ mediaUrl: 'https://example.com/care.mp4' });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('INVALID_MODEL_OUTPUT');
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('maps model timeout to 504 ARK_TIMEOUT', async () => {
    const client = fakeClient([new ArkError('ARK_TIMEOUT', '模型请求超时')]);
    const response = await request(createApp({ arkClient: client, skipAuth: true }))
      .post('/api/analyze')
      .send({ mediaUrl: 'https://example.com/care.mp4' });

    expect(response.status).toBe(504);
    expect(response.body.code).toBe('ARK_TIMEOUT');
  });

  it('rejects requests without mediaUrl', async () => {
    const client = fakeClient([]);
    const response = await request(createApp({ arkClient: client, skipAuth: true }))
      .post('/api/analyze')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_REQUEST');
    expect(client.chat).not.toHaveBeenCalled();
  });
});
