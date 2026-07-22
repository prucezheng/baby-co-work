// 家庭成员与家庭组管理
// GET  /api/families/:id          — 获取家庭详情
// PATCH /api/families/:id/members/:memberId — 更新成员信息
// GET  /api/families/:id/members  — 列出所有成员

import { Router } from 'express';
import { z } from 'zod';
import type { FamilyRepository } from '../repositories/types';

const updateMemberSchema = z.object({
  experience: z.enum(['beginner', 'basic', 'experienced', 'professional']).optional(),
  available_slots: z.array(z.enum(['morning', 'daytime', 'evening', 'night'])).max(4).optional(),
  limitations: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  preference: z.enum(['lead', 'assist', 'simple']).optional(),
  temporary_unavailable: z.boolean().optional()
});

export function createFamiliesRouter(familyRepo: FamilyRepository): Router {
  const router = Router();

  // GET /api/families/:id
  router.get('/:id', async (req, res) => {
    try {
      const family = await familyRepo.getFamily(req.params.id);
      if (!family) {
        res.status(404).json({ code: 'FAMILY_NOT_FOUND', message: '家庭不存在' });
        return;
      }

      // 鉴权：只有家庭成员可查看
      if (req.session && req.session.familyId !== req.params.id) {
        res.status(403).json({ code: 'FORBIDDEN', message: '无权访问该家庭' });
        return;
      }

      res.json(family);
    } catch (error) {
      console.error('[families] get error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  // GET /api/families/:id/members
  router.get('/:id/members', async (req, res) => {
    try {
      if (req.session && req.session.familyId !== req.params.id) {
        res.status(403).json({ code: 'FORBIDDEN', message: '无权访问该家庭' });
        return;
      }
      const members = await familyRepo.listMembers(req.params.id);
      res.json({ members });
    } catch (error) {
      console.error('[families] list members error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  // PATCH /api/families/:id/members/:memberId
  router.patch('/:id/members/:memberId', async (req, res) => {
    try {
      if (req.session && req.session.familyId !== req.params.id) {
        res.status(403).json({ code: 'FORBIDDEN', message: '无权访问该家庭' });
        return;
      }

      const parsed = updateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合成员更新规范' });
        return;
      }

      const updated = await familyRepo.updateMember(
        req.params.id,
        req.params.memberId,
        parsed.data
      );
      res.json({ member: updated });
    } catch (error) {
      console.error('[families] update member error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
