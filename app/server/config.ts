// 环境变量读取与校验。API Key 只允许服务端读取。

export interface ServerConfig {
  arkApiKey: string | null;
  arkModel: string;
  arkBaseUrl: string;
  publicBaseUrl: string;
  mediaTtlHours: number;
  port: number;
}

// 本地开发时尝试加载 app/.env；文件不存在时静默忽略（生产环境用真实环境变量）
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // .env 不存在或不可读，继续使用 process.env
}

export function getConfig(): ServerConfig {
  return {
    arkApiKey: process.env.ARK_API_KEY?.trim() || null,
    arkModel: process.env.ARK_MODEL ?? 'doubao-seed-2-0-lite-260428',
    arkBaseUrl: process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4174}`,
    mediaTtlHours: Number(process.env.MEDIA_TTL_HOURS ?? 24),
    port: Number(process.env.PORT ?? 4174)
  };
}
