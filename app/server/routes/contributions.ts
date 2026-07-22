// 贡献统计路由
// GET /api/contributions?family_id=xxx — 获取家庭贡献数据

import { Router } from 'express';
import type { ContributionService } from '../services/contribution';
import type { FamilyRepository } from '../repositories/types';

export function createContributionsRouter(
  contributionService: ContributionService,
  familyRepo: FamilyRepository
): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const familyId = req.query.family_id as string | undefined;
      if (!familyId) {
        res.status(400).json({ code: 'MISSING_PARAM', message: '缺少 family_id 参数' });
        return;
      }

      if (req.session && req.session.familyId !== familyId) {
        res.status(403).json({ code: 'FORBIDDEN', message: '无权访问该家庭' });
        return;
      }

      // 获取成员名称映射
      const members = await familyRepo.listMembers(familyId);
      const memberNames = new Map(members.map((m) => [m.member_id, m.display_name]));

      const contribution = await contributionService.getFamilyContribution(familyId, memberNames);
      res.json(contribution);
    } catch (error) {
      console.error('[contributions] error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
