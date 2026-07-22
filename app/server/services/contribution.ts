// 贡献统计服务：从不可变完成事件派生贡献数据。
// 子步骤不单独计贡献，只统计父任务的 completed 事件。

import type { CompletionEvent } from '../../src/domain/types';
import type { EventRepository, TaskRepository } from '../repositories/types';

export interface MemberContribution {
  memberId: string;
  displayName: string;
  completedCount: number;
  substituteCount: number;
  /** YYYY-MM-DD → 当日完成数 */
  dailyCounts: Record<string, number>;
}

export interface FamilyContribution {
  familyId: string;
  members: MemberContribution[];
  /** YYYY-MM-DD → 当日家庭总完成数 */
  dailyTotal: Record<string, number>;
}

export class ContributionService {
  constructor(
    private eventRepo: EventRepository,
    private taskRepo: TaskRepository
  ) {}

  async getFamilyContribution(
    familyId: string,
    memberNames: Map<string, string>
  ): Promise<FamilyContribution> {
    const events = await this.eventRepo.listEventsByFamily(familyId);

    // 只统计 completed 事件（undo/skipped/reassigned 不计入贡献）
    const completedEvents = events.filter((e) => e.event_type === 'completed');

    const memberMap = new Map<string, MemberContribution>();
    const dailyTotal: Record<string, number> = {};

    for (const event of completedEvents) {
      const actorId = event.actor_member_id;
      if (!memberMap.has(actorId)) {
        memberMap.set(actorId, {
          memberId: actorId,
          displayName: memberNames.get(actorId) ?? actorId,
          completedCount: 0,
          substituteCount: 0,
          dailyCounts: {}
        });
      }

      const m = memberMap.get(actorId)!;
      m.completedCount++;
      if (event.completion_source === 'substitute') {
        m.substituteCount++;
      }

      // 按日期聚合
      const dateKey = event.occurred_at.slice(0, 10); // YYYY-MM-DD
      m.dailyCounts[dateKey] = (m.dailyCounts[dateKey] ?? 0) + 1;
      dailyTotal[dateKey] = (dailyTotal[dateKey] ?? 0) + 1;
    }

    return {
      familyId,
      members: Array.from(memberMap.values()).sort((a, b) => b.completedCount - a.completedCount),
      dailyTotal
    };
  }
}
