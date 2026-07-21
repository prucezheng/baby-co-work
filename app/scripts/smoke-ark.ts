// 真实冒烟测试：用真实 API Key 调用豆包视频理解，验证完整链路。
// 用法（拿到 Key 后）：
//   $env:ARK_API_KEY="你的Key"
//   npm run smoke:ark -- --media-url https://你的视频地址.mp4
// 不在日志中打印 API Key。

import { createArkClient } from '../server/services/ark-client';
import { parseAnalysisOutput } from '../server/services/model-json';
import { VIDEO_ANALYSIS_PROMPT } from '../server/prompts';
import { getConfig } from '../server/config';

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const config = getConfig();
  if (!config.arkApiKey) {
    throw new Error('请先在当前终端设置 ARK_API_KEY');
  }
  const mediaUrl = readArg('--media-url') ?? process.env.PRESET_VIDEO_URL;
  if (!mediaUrl) {
    throw new Error('请通过 --media-url 或 PRESET_VIDEO_URL 提供视频地址');
  }

  const client = createArkClient({
    apiKey: config.arkApiKey,
    model: config.arkModel,
    baseUrl: config.arkBaseUrl
  });

  console.log(`[smoke] 调用模型 ${config.arkModel} 分析视频…`);
  const startedAt = Date.now();
  const raw = await client.chat([
    { type: 'video_url', video_url: { url: mediaUrl } },
    { type: 'text', text: VIDEO_ANALYSIS_PROMPT }
  ]);
  const analysis = parseAnalysisOutput(raw, 'smoke-video');
  console.log(`[smoke] 成功，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
  console.log(JSON.stringify(analysis, null, 2));
}

main().catch((error: unknown) => {
  console.error('[smoke] 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
