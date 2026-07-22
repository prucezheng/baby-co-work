// Session 鉴权中间件：从 Authorization: Bearer <token> 提取会话，
// 校验后将 familyId / memberId 挂载到 req 上供下游路由使用。

import type { Request, Response, NextFunction } from 'express';
import type { SessionStore } from '../services/session-store';

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      session?: {
        familyId: string;
        memberId: string;
        displayName: string;
        role: string;
      };
    }
  }
}

export function createSessionMiddleware(sessionStore: SessionStore) {
  // 无需鉴权的路径
  const PUBLIC_PATHS = new Set(['/api/auth/join', '/api/auth/unlock']);

  return function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
    // 健康检查与公开路径放行
    if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(req.path)) {
      next();
      return;
    }

    // 仅对 /api/ 路径要求鉴权
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '缺少认证令牌' });
      return;
    }

    const session = sessionStore.get(token);
    if (!session) {
      res.status(401).json({ code: 'SESSION_EXPIRED', message: '会话已过期，请重新解锁' });
      return;
    }

    req.session = {
      familyId: session.familyId,
      memberId: session.memberId,
      displayName: session.displayName,
      role: session.role
    };
    next();
  };
}
