// 真实冒烟测试：验证豆包视频理解完整链路。
//
// 用法 A（本地视频文件，推荐）：
//   npm run smoke:ark -- --file ../testvideo.mp4
//   流程：Files API 上传 → 等待处理 → Responses API input_video 分析
//
// 用法 B（公网视频 URL）：
//   $env:PRESET_VIDEO_URL="https://..."
//   npm run smoke:ark -- --media-url $env:PRESET_VIDEO_URL
//
// API Key 从 app/.env 或环境变量 ARK_API_KEY 读取，绝不打印。

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createArkClient } from '../server/services/ark-client';
import { parseAnalysisOutput } from '../server/services/model-json';
import { VIDEO_ANALYSIS_PROMPT } from '../server/prompts';
import { getConfig } from '../server/config';

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function uploadFile(filePath: string, apiKey: string, baseUrl: string): Promise<string> {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.set('purpose', 'user_data');
  form.set('preprocess_configs[video][fps]', '0.3');
  form.set('file', new Blob([buffer], { type: 'video/mp4' }), basename(filePath));

  console.log(`[smoke] 上传 ${basename(filePath)}（${(buffer.length / 1024 / 1024).toFixed(1)} MB）…`);
  const response = await fetch(`${baseUrl}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) {
    throw new Error(`文件上传失败 HTTP ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error(`上传响应缺少 id: ${JSON.stringify(data)}`);
  return data.id;
}

async function waitForFile(fileId: string, apiKey: string, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const response = await fetch(`${baseUrl}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      throw new Error(`文件状态查询失败 HTTP ${response.status}`);
    }
    const data = (await response.json()) as { status?: string };
    const status = (data.status ?? '').toLowerCase();
    if (!status || ['processed', 'completed', 'succeeded', 'success', 'available', 'ready', 'active'].includes(status)) {
      return;
    }
    if (['failed', 'error', 'cancelled', 'expired'].includes(status)) {
      throw new Error(`文件处理失败: ${JSON.stringify(data)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`文件处理超时，最后状态: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

interface ResponsesApiResult {
  status?: string;
  error?: unknown;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

async function analyzeByFileId(fileId: string, apiKey: string, model: string, baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_video', file_id: fileId },
            { type: 'input_text', text: VIDEO_ANALYSIS_PROMPT }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) {
    throw new Error(`Responses API 失败 HTTP ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as ResponsesApiResult;
  if (data.error) throw new Error(`Responses API 错误: ${JSON.stringify(data.error)}`);
  const text = (data.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && part.text)
    .map((part) => part.text as string)
    .join('\n');
  if (!text) throw new Error(`Responses API 未返回文本: ${JSON.stringify(data).slice(0, 500)}`);
  return text;
}

async function main() {
  const config = getConfig();
  if (!config.arkApiKey) {
    throw new Error('请先在 app/.env 或当前终端设置 ARK_API_KEY');
  }
  const startedAt = Date.now();

  let raw: string;
  const filePath = readArg('--file');
  if (filePath) {
    const fileId = await uploadFile(filePath, config.arkApiKey, config.arkBaseUrl);
    console.log(`[smoke] 上传完成 file_id=${fileId}，等待预处理…`);
    await waitForFile(fileId, config.arkApiKey, config.arkBaseUrl);
    console.log(`[smoke] 调用模型 ${config.arkModel} 分析视频…`);
    raw = await analyzeByFileId(fileId, config.arkApiKey, config.arkModel, config.arkBaseUrl);
  } else {
    const mediaUrl = readArg('--media-url') ?? process.env.PRESET_VIDEO_URL;
    if (!mediaUrl) throw new Error('请通过 --file 或 --media-url 提供视频');
    console.log(`[smoke] 调用模型 ${config.arkModel} 分析视频 URL…`);
    const client = createArkClient({
      apiKey: config.arkApiKey,
      model: config.arkModel,
      baseUrl: config.arkBaseUrl
    });
    raw = await client.chat([
      { type: 'video_url', video_url: { url: mediaUrl } },
      { type: 'text', text: VIDEO_ANALYSIS_PROMPT }
    ]);
  }

  try {
    const analysis = parseAnalysisOutput(raw, 'smoke-video');
    console.log(`[smoke] 成功，总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
    console.log(JSON.stringify(analysis, null, 2));
  } catch (error) {
    if (error instanceof Error && error.name === 'ModelOutputError') {
      console.error('[smoke] 结构校验失败，Zod 错误：');
      console.error(JSON.stringify((error as { issues?: unknown }).issues, null, 2));
      console.error('[smoke] 模型原始输出（前 2000 字）：');
      console.error(raw.slice(0, 2000));
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error('[smoke] 失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
