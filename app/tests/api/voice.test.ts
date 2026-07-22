import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import type { ArkClient } from '../../server/services/ark-client';
import type { AudioTranscriber } from '../../server/services/audio-transcriber';
import { TranscriptionServiceError } from '../../server/services/audio-transcriber';
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

function fakeTranscriber(result: string | Error): AudioTranscriber & { transcribe: ReturnType<typeof vi.fn> } {
  const transcribe = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { transcribe };
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
    member_id: 'mom-1',
    display_name: '妈妈',
    role: '妈妈',
    pin_hash: 'hash',
    identity_claimed: true,
    experience: 'experienced',
    available_slots: ['morning', 'daytime', 'evening', 'night'],
    limitations: [],
    preference: 'lead',
    temporary_unavailable: false
  }
];

function validVoiceRequest(app: ReturnType<typeof createApp>) {
  return request(app)
    .post('/api/tasks/from-voice')
    .field('request_id', 'voice-req-1')
    .field('family_id', 'family-1')
    .field('creator_member_id', 'mom-1')
    .field('recording_duration_sec', '12')
    .field('members', JSON.stringify(members))
    .field('current_time', '2026-07-21T18:00:00+08:00')
    .attach('audio', Buffer.from('fake-webm-audio'), {
      filename: 'recording.webm',
      contentType: 'audio/webm'
    });
}

describe('POST /api/tasks/from-voice', () => {
  it('transcribes audio and publishes a voice task through the same task pipeline', async () => {
    const arkClient = fakeClient([JSON.stringify(fixture)]);
    const audioTranscriber = fakeTranscriber('爸爸今晚八点前把宝宝睡前用品准备好');
    const response = await validVoiceRequest(createApp({ arkClient, audioTranscriber, skipAuth: true }));

    expect(response.status).toBe(201);
    expect(response.body.transcript).toContain('爸爸今晚');
    expect(response.body.task.input_type).toBe('voice');
    expect(response.body.task.raw_input).toBe(response.body.transcript);
    expect(response.body.task.subtasks).toHaveLength(3);
    expect(audioTranscriber.transcribe).toHaveBeenCalledTimes(1);
    expect(arkClient.chat).toHaveBeenCalledTimes(1);
  });

  it('rejects recordings longer than 60 seconds before transcribing', async () => {
    const arkClient = fakeClient([]);
    const audioTranscriber = fakeTranscriber('不会被调用');
    const app = createApp({ arkClient, audioTranscriber, skipAuth: true });
    const response = await request(app)
      .post('/api/tasks/from-voice')
      .field('request_id', 'voice-req-2')
      .field('recording_duration_sec', '61')
      .field('members', JSON.stringify(members))
      .attach('audio', Buffer.from('fake-webm-audio'), {
        filename: 'recording.webm',
        contentType: 'audio/webm'
      });

    expect(response.status).toBe(400);
    expect(audioTranscriber.transcribe).not.toHaveBeenCalled();
  });

  it('returns TRANSCRIPTION_FAILED when Doubao transcription cannot produce text', async () => {
    const arkClient = fakeClient([]);
    const audioTranscriber = fakeTranscriber(
      new TranscriptionServiceError('TRANSCRIPTION_FAILED', '未识别到有效语音内容')
    );
    const response = await validVoiceRequest(createApp({ arkClient, audioTranscriber, skipAuth: true }));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('TRANSCRIPTION_FAILED');
    expect(arkClient.chat).not.toHaveBeenCalled();
  });
});
