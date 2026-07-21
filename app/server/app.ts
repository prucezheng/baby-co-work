import express from 'express';
import { createAnalyzeRouter } from './routes/analyze';
import { createArkClient, ArkError } from './services/ark-client';
import type { ArkClient } from './services/ark-client';
import { getConfig } from './config';

export interface AppDependencies {
  arkClient?: ArkClient;
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
  const arkClient =
    deps.arkClient ??
    (config.arkApiKey
      ? createArkClient({ apiKey: config.arkApiKey, model: config.arkModel, baseUrl: config.arkBaseUrl })
      : createMissingKeyClient());

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/analyze', createAnalyzeRouter(arkClient));
  return app;
}
