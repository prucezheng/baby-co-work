// 语音输入路由：支持 JSON base64 与 multipart 音频两种 MVP 入口，
// 转写后统一走 TaskOrchestrator，避免语音和文字使用两套任务生成逻辑。

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { TaskOrchestrator } from '../services/task-orchestrator';
import type { AudioTranscriber } from '../services/audio-transcriber';
import { TranscriptionServiceError } from '../services/audio-transcriber';
import type { FamilyRepository } from '../repositories/types';
import { familyMemberSchema, voiceTaskInputSchema } from '../../src/domain/schemas';
import { ArkError } from '../services/ark-client';
import { ModelOutputError } from '../services/model-json';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 26_214_400, files: 1 }
});

const jsonVoiceSchema = z.object({
  request_id: z.string().trim().min(1).max(120),
  family_id: z.string().trim().min(1).max(64),
  creator_member_id: z.string().trim().min(1).max(64),
  raw_input: z.string().trim().min(2).max(500),
  audio_base64: z.string().min(1).optional(),
  audio_mime_type: z.enum(['audio/webm', 'audio/mp4', 'audio/wav']).optional(),
  transcript: z.string().trim().min(2).max(500).optional(),
  recording_duration_sec: z.number().int().min(1).max(60)
});

const multipartVoiceSchema = z.object({
  request_id: z.string().trim().min(1).max(120),
  family_id: z.string().trim().min(1).max(64).default('family-demo'),
  creator_member_id: z.string().trim().min(1).max(64).default('member-mom'),
  recording_duration_sec: z.coerce.number().int().min(1).max(60),
  members: z.string().transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value);
      return z.array(familyMemberSchema).min(1).max(8).parse(parsed);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'members 必须是合法 JSON 家庭成员数组' });
      return z.NEVER;
    }
  }),
  current_time: z.string().datetime({ offset: true }).optional(),
  daily_load_minutes: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      try {
        return z.record(z.string(), z.number().int().min(0)).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'daily_load_minutes 必须是合法 JSON 对象' });
        return z.NEVER;
      }
    })
});

export function createVoiceRouter(
  orchestrator: TaskOrchestrator,
  transcriber: AudioTranscriber,
  familyRepo: FamilyRepository
): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = jsonVoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合语音输入规范' });
      return;
    }

    const data = parsed.data;

    try {
      let transcript = data.transcript;
      if (!transcript && data.audio_base64) {
        transcript = await transcriber.transcribe({
          buffer: Buffer.from(data.audio_base64, 'base64'),
          originalName: 'recording.webm',
          mimeType: data.audio_mime_type ?? 'audio/webm'
        });
      }
      if (!transcript) {
        res.status(400).json({
          code: 'MISSING_TRANSCRIPT',
          message: '语音转写失败，请提供 transcript 字段或确认音频质量'
        });
        return;
      }

      const members = await familyRepo.listMembers(data.family_id);
      const request = voiceTaskInputSchema.parse({
        request_id: data.request_id,
        family_id: data.family_id,
        creator_member_id: data.creator_member_id,
        input_type: 'voice',
        raw_input: transcript,
        recording_duration_sec: data.recording_duration_sec,
        transcript
      });

      const result = await orchestrator.createTask({
        input: request,
        members,
        currentTime: new Date().toISOString()
      });

      res.status(201).json({ task: result.task, transcript });
    } catch (error) {
      sendVoiceError(res, error);
    }
  });

  router.post('/from-voice', upload.single('audio'), async (req, res) => {
    const parsed = multipartVoiceSchema.safeParse(req.body);
    if (!parsed.success || !req.file) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: '请求必须包含 audio、request_id、recording_duration_sec 和 members'
      });
      return;
    }

    try {
      const transcript = await transcriber.transcribe({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype
      });
      const request = voiceTaskInputSchema.parse({
        request_id: parsed.data.request_id,
        family_id: parsed.data.family_id,
        creator_member_id: parsed.data.creator_member_id,
        input_type: 'voice',
        raw_input: transcript,
        recording_duration_sec: parsed.data.recording_duration_sec,
        transcript
      });
      const result = await orchestrator.createTask({
        input: request,
        members: parsed.data.members,
        currentTime: parsed.data.current_time,
        dailyLoadMinutes: parsed.data.daily_load_minutes
      });
      res.status(201).json({ transcript, task: result.task });
    } catch (error) {
      sendVoiceError(res, error);
    }
  });

  return router;
}

function sendVoiceError(res: { status(status: number): { json(body: unknown): void } }, error: unknown) {
  if (error instanceof TranscriptionServiceError) {
    const status = error.code === 'AUDIO_EMPTY' || error.code === 'AUDIO_TOO_LARGE' ? 400 : 422;
    res.status(status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof ArkError) {
    const status = error.code === 'ARK_TIMEOUT' ? 504 : 503;
    res.status(status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof ModelOutputError) {
    res.status(502).json({ code: 'INVALID_MODEL_OUTPUT', message: error.message });
    return;
  }
  console.error('[voice] create error:', error);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
}
