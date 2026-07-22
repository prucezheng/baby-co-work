// 会话存储：内存 Map，支持过期清理。
// 生产环境可替换为 Redis 或数据库 backed session。

import { randomUUID } from 'node:crypto';

export interface Session {
  token: string;
  familyId: string;
  memberId: string;
  displayName: string;
  role: string;
  createdAt: number;
  expiresAt: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private ttlMs: number;

  constructor(ttlHours: number) {
    this.ttlMs = ttlHours * 3600_000;
  }

  create(familyId: string, memberId: string, displayName: string, role: string): Session {
    const now = Date.now();
    const session: Session = {
      token: randomUUID(),
      familyId,
      memberId,
      displayName,
      role,
      createdAt: now,
      expiresAt: now + this.ttlMs
    };
    this.sessions.set(session.token, session);
    return session;
  }

  get(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  delete(token: string): void {
    this.sessions.delete(token);
  }

  /** 清除所有过期会话，返回清除数量 */
  prune(): number {
    const now = Date.now();
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }
}
