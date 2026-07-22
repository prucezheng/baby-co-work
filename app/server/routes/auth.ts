// 认证路由：加入家庭（新建或加入已有）+ PIN 解锁（返回用户重新登录）。
// POST /api/auth/join   — 创建或加入家庭，设置 PIN
// POST /api/auth/unlock — 输入已有成员 PIN 解锁

import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hashPin, verifyPin } from '../services/pin';
import type { SessionStore } from '../services/session-store';
import type { FamilyRepository } from '../repositories/types';
import type { FamilyMember } from '../../src/domain/types';

const joinSchema = z.object({
  family_id: z.string().trim().min(1).max(64).optional(),
  family_display_name: z.string().trim().min(1).max(40).optional(),
  display_name: z.string().trim().min(1).max(20),
  role: z.string().trim().min(1).max(20),
  pin: z.string().trim().min(4).max(16),
  experience: z.enum(['beginner', 'basic', 'experienced', 'professional']).optional()
});

const unlockSchema = z.object({
  member_id: z.string().trim().min(1).max(64),
  pin: z.string().trim().min(1).max(16)
});

type TimeSlot = 'morning' | 'daytime' | 'evening' | 'night';

function buildMember(overrides: {
  member_id: string;
  display_name: string;
  role: string;
  pin: string;
  experience?: 'beginner' | 'basic' | 'experienced' | 'professional';
}): FamilyMember {
  return {
    member_id: overrides.member_id,
    display_name: overrides.display_name,
    role: overrides.role,
    pin_hash: hashPin(overrides.pin),
    identity_claimed: true,
    experience: overrides.experience,
    available_slots: [] as TimeSlot[],
    limitations: [],
    preference: 'assist',
    temporary_unavailable: false
  };
}

export function createAuthRouter(
  familyRepo: FamilyRepository,
  sessionStore: SessionStore
): Router {
  const router = Router();

  // POST /api/auth/join
  router.post('/join', async (req, res) => {
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合认证规范' });
      return;
    }

    const { family_id, family_display_name, display_name, role, pin, experience } = parsed.data;

    try {
      // 场景 A：加入已有家庭
      if (family_id) {
        const existing = await familyRepo.getFamily(family_id);
        if (!existing) {
          res.status(404).json({ code: 'FAMILY_NOT_FOUND', message: '家庭不存在' });
          return;
        }

        // 检查 display_name 是否已被占用
        const nameTaken = existing.members.some((m) => m.display_name === display_name);
        if (nameTaken) {
          res.status(409).json({ code: 'NAME_TAKEN', message: '该称呼已被占用' });
          return;
        }

        const memberId = `member-${randomUUID().slice(0, 12)}`;
        const member = buildMember({ member_id: memberId, display_name, role, pin, experience });
        const created = await familyRepo.addMember(family_id, member);
        const session = sessionStore.create(family_id, memberId, display_name, role);

        res.status(201).json({
          token: session.token,
          member: created,
          family: existing.family
        });
        return;
      }

      // 场景 B：创建新家庭
      if (!family_display_name) {
        res.status(400).json({ code: 'MISSING_NAME', message: '创建家庭需要提供 family_display_name' });
        return;
      }

      const newFamilyId = `family-${randomUUID().slice(0, 12)}`;
      const newMemberId = `member-${randomUUID().slice(0, 12)}`;

      const familyRecord = {
        family_id: newFamilyId,
        display_name: family_display_name,
        creator_member_id: newMemberId,
        created_at: new Date().toISOString()
      };

      const creator = buildMember({ member_id: newMemberId, display_name, role, pin, experience });
      const created = await familyRepo.createFamily(familyRecord, creator);
      const session = sessionStore.create(newFamilyId, newMemberId, display_name, role);

      res.status(201).json({
        token: session.token,
        member: creator,
        family: created.family
      });
    } catch (error) {
      console.error('[auth] join error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  // POST /api/auth/unlock
  router.post('/unlock', async (req, res) => {
    const parsed = unlockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: '请求体不符合解锁规范' });
      return;
    }

    const { member_id, pin } = parsed.data;

    try {
      const found = await familyRepo.findMemberById(member_id);
      if (!found) {
        res.status(404).json({ code: 'MEMBER_NOT_FOUND', message: '成员不存在' });
        return;
      }

      const { familyId, member } = found;
      if (!verifyPin(pin, member.pin_hash)) {
        res.status(401).json({ code: 'WRONG_PIN', message: 'PIN 不正确' });
        return;
      }

      const session = sessionStore.create(familyId, member.member_id, member.display_name, member.role);
      const family = await familyRepo.getFamily(familyId);

      res.json({
        token: session.token,
        member,
        family: family?.family ?? null
      });
    } catch (error) {
      console.error('[auth] unlock error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务内部错误' });
    }
  });

  return router;
}
