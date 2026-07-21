import { analysisSchema } from '../../src/domain/schemas';
import type { Analysis } from '../../src/domain/types';
import { upgradeStepRisk } from './safety';

export class ModelOutputError extends Error {
  readonly issues?: unknown;

  constructor(message: string, issues?: unknown) {
    super(message);
    this.name = 'ModelOutputError';
    this.issues = issues;
  }
}

// 去除 Markdown 代码围栏并解析 JSON；非 JSON 直接抛错
export function extractJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ModelOutputError('模型返回不是合法 JSON');
  }
}

// 解析流程：去围栏 → JSON.parse → 覆盖 videoId → 关键词风险升级 → Zod 校验
export function parseAnalysisOutput(raw: string, videoId: string): Analysis {
  const data = extractJson(raw);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ModelOutputError('模型输出不是 JSON 对象');
  }
  const record = data as Record<string, unknown>;
  record.videoId = videoId;
  if (Array.isArray(record.steps)) {
    record.steps = record.steps.map((step) => upgradeStepRisk(step));
  }
  const result = analysisSchema.safeParse(record);
  if (!result.success) {
    throw new ModelOutputError('模型输出不符合结构规范', result.error.issues);
  }
  return result.data;
}
