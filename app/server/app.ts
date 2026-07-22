import express from 'express';
import { createAnalyzeRouter } from './routes/analyze';
import { createTasksRouter } from './routes/tasks';
import { createAuthRouter } from './routes/auth';
import { createVoiceRouter } from './routes/voice';
import { createFamiliesRouter } from './routes/families';
import { createAttachmentsRouter } from './routes/attachments';
import { createContributionsRouter } from './routes/contributions';
import { createSessionMiddleware } from './middleware/session';
import { createArkClient, ArkError } from './services/ark-client';
import { SessionStore } from './services/session-store';
import { JsonRepository } from './repositories/json-family-repository';
import { TaskOrchestrator } from './services/task-orchestrator';
import { TaskEventService } from './services/task-events';
import { ContributionService } from './services/contribution';
import { createAudioTranscriber } from './services/audio-transcriber';
import type { ArkClient } from './services/ark-client';
import type { FamilyRepository, TaskRepository, EventRepository } from './repositories/types';
import { getConfig } from './config';

export interface AppDependencies {
  arkClient?: ArkClient;
  familyRepo?: FamilyRepository;
  taskRepo?: TaskRepository;
  eventRepo?: EventRepository;
  sessionStore?: SessionStore;
  /** 跳过 session 鉴权（测试用） */
  skipAuth?: boolean;
}

// 未配置 API Key 时的占位客户端：请求才报错，不阻塞服务启动
function createMissingKeyClient(): ArkClient {
  return {
    async chat() {
      throw new ArkError('ARK_UNAVAILABLE', '服务端未配置 ARK_API_KEY');
    }
  };
}

export function createApp(deps: AppDependencies = {}) {
  const config = getConfig();

  // ---- 基础设施 ----
  // 测试环境 (NODE_ENV=test) 使用内存存储以避免文件并发问题
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const familyRepo: FamilyRepository =
    deps.familyRepo ?? (isTest ? new JsonRepository(':memory:') : new JsonRepository(config.dataDir));
  const taskRepo: TaskRepository =
    deps.taskRepo ?? (familyRepo as unknown as TaskRepository);
  const eventRepo: EventRepository =
    deps.eventRepo ?? (familyRepo as unknown as EventRepository);

  const sessionStore = deps.sessionStore ?? new SessionStore(config.sessionTtlHours);

  // ---- Ark 客户端 ----
  const arkClient =
    deps.arkClient ??
    (config.arkApiKey
      ? createArkClient({ apiKey: config.arkApiKey, model: config.arkModel, baseUrl: config.arkBaseUrl })
      : createMissingKeyClient());

  // ---- 业务服务 ----
  const orchestrator = new TaskOrchestrator(arkClient, taskRepo);
  const taskEventService = new TaskEventService(taskRepo, eventRepo);
  const contributionService = new ContributionService(eventRepo, taskRepo);
  const transcriber = createAudioTranscriber();

  // ---- Express 应用 ----
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Session 鉴权中间件
  if (!deps.skipAuth) {
    app.use(createSessionMiddleware(sessionStore));
  }

  // 公开路由
  app.use('/api/auth', createAuthRouter(familyRepo, sessionStore));

  // 受保护路由
  app.use('/api/analyze', createAnalyzeRouter(arkClient));
  app.use('/api/tasks', createTasksRouter(orchestrator, taskEventService, taskRepo, familyRepo));
  app.use('/api/voice', createVoiceRouter(orchestrator, transcriber, familyRepo));
  app.use('/api/families', createFamiliesRouter(familyRepo));
  app.use('/api/attachments', createAttachmentsRouter(taskRepo));
  app.use('/api/contributions', createContributionsRouter(contributionService, familyRepo));

  // 挂载到 app.locals，供测试与下游访问
  app.locals.repo = familyRepo;
  app.locals.sessionStore = sessionStore;
  app.locals.orchestrator = orchestrator;

  return app;
}
