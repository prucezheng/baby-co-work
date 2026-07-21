import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { VIDEO_ANALYSIS_PROMPT, buildRepairPrompt } from '../prompts';
import type { ArkClient } from '../services/ark-client';
import { ArkError } from '../services/ark-client';
import { ModelOutputError, parseAnalysisOutput } from '../services/model-json';
import { getConfig } from '../config';

const requestSchema = z.object({
  mediaUrl: z.string().min(1),
  videoId: z.string().min(1).optional()
});

// 相对路径（如 /api/media/xxx）补全为公网可访问的绝对 URL
function toAbsoluteMediaUrl(mediaUrl: string): string {
  if (/^https?:\/\//.test(mediaUrl)) return mediaUrl;
  return `${getConfig().publicBaseUrl}${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
}

export function createAnalyzeRouter(arkClient: ArkClient): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体必须包含 mediaUrl' });
      return;
    }

    const { mediaUrl } = parsed.data;
    const videoId = parsed.data.videoId ?? randomUUID();
    const absoluteUrl = toAbsoluteMediaUrl(mediaUrl);

    try {
      const raw = await arkClient.chat([
        { type: 'video_url', video_url: { url: absoluteUrl } },
        { type: 'text', text: VIDEO_ANALYSIS_PROMPT }
      ]);

      try {
        res.json({ analysis: parseAnalysisOutput(raw, videoId) });
        return;
      } catch (firstError) {
        if (!(firstError instanceof ModelOutputError)) throw firstError;

        // 结构校验失败：携带原始输出与 Zod 错误，自动修复一次
        const repaired = await arkClient.chat([
          { type: 'text', text: buildRepairPrompt(raw, firstError.issues) }
        ]);
        res.json({ analysis: parseAnalysisOutput(repaired, videoId), repaired: true });
        return;
      }
    } catch (error) {
      if (error instanceof ArkError) {
        const status = error.code === 'ARK_TIMEOUT' ? 504 : 503;
        res.status(status).json({ code: error.code, message: error.message });
        return;
      }
      if (error instanceof ModelOutputError) {
        res.status(502).json({ code: 'INVALID_MODEL_OUTPUT', message: error.message });
        return;
      }
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
