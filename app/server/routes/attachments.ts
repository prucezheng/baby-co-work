// 视频附件路由：上传参考视频作为任务的"怎么完成"附件。
// 视频上传不触发 Ark 任务生成或子任务生成（PRD v1.1 边界约束）。
// POST /api/attachments — 上传视频文件

import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';
import type { TaskRepository } from '../repositories/types';
import type { ReferenceVideoAttachment } from '../../src/domain/types';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的视频格式: ${file.mimetype}`));
    }
  }
});

export function createAttachmentsRouter(taskRepo: TaskRepository): Router {
  const router = Router();

  router.post('/', upload.single('video'), async (req, res) => {
    try {
      const taskId = req.body?.task_id as string | undefined;
      const note = req.body?.note as string | undefined;

      if (!taskId) {
        res.status(400).json({ code: 'MISSING_PARAM', message: '缺少 task_id' });
        return;
      }

      // 确认任务存在
      const task = await taskRepo.getTask(taskId);
      if (!task) {
        res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ code: 'MISSING_FILE', message: '未上传视频文件' });
        return;
      }

      const config = getConfig();
      const attachment: ReferenceVideoAttachment = {
        attachment_id: `attachment-${randomUUID().slice(0, 12)}`,
        task_id: taskId,
        file_name: file.originalname,
        mime_type: file.mimetype as 'mp4' | 'mov' | 'webm',
        file_size: file.size,
        note: note?.slice(0, 100),
        status: 'ready',
        expires_at: new Date(Date.now() + config.mediaTtlHours * 3600_000).toISOString()
      };

      // MVP：视频存储在内存中，生产环境应上传到对象存储
      // 此处仅记录元数据，实际文件由客户端直传 Supabase Storage 等
      res.status(201).json({ attachment });
    } catch (error) {
      console.error('[attachments] error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
