// 语音输入路由：接收 base64 音频 + 可选的客户端转写文本
// POST /api/voice — 转写并直接创建任务（走 TaskOrchestrator）

import { Router } from 'express';
import { z } from 'zod';
import type { TaskOrchestrator } from '../services/task-orchestrator';
import type { AudioTranscriber } from '../services/audio-transcriber';
import type { FamilyRepository } from '../repositories/types';

const voiceSchema = z.object({
  request_id: z.string().trim().min(1).max(120),
  family_id: z.string().trim().min(1).max(64),
  creator_member_id: z.string().trim().min(1).max(64),
  raw_input: z.string().trim().min(2).max(500),
  audio_base64: z.string().min(1).optional(),
  audio_mime_type: z.enum(['audio/webm', 'audio/mp4', 'audio/wav']).optional(),
  transcript: z.string().trim().min(2).max(500).optional(),
  recording_duration_sec: z.number().int().min(1).max(60)
});

export function createVoiceRouter(
  orchestrator: TaskOrchestrator,
  transcriber: AudioTranscriber,
  familyRepo: FamilyRepository
): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = voiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合语音输入规范' });
      return;
    }

    const data = parsed.data;

    try {
      // 如果客户端未提供转写文本，尝试服务端转写
      let transcript = data.transcript;
      if (!transcript && data.audio_base64) {
        transcript = await transcriber.transcribe(data.audio_base64, data.audio_mime_type ?? 'audio/webm');
      }
      if (!transcript) {
        res.status(400).json({
          code: 'MISSING_TRANSCRIPT',
          message: '语音转写失败，请提供 transcript 字段或确认音频质量'
        });
        return;
      }

      // 获取家庭所有成员
      const members = await familyRepo.listMembers(data.family_id);

      // 通过编排器创建任务
      const result = await orchestrator.createTask({
        input: {
          request_id: data.request_id,
          family_id: data.family_id,
          creator_member_id: data.creator_member_id,
          input_type: 'voice',
          raw_input: data.raw_input
        },
        members,
        currentTime: new Date().toISOString()
      });

      res.status(201).json({ task: result.task, transcript });
    } catch (error) {
      console.error('[voice] create error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
