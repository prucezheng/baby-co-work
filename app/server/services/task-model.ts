// 任务模型服务：调用 Ark 模型生成任务草稿，含自动修复。
// 将 Ark 调用 + Prompt 构建 + 输出解析从 routes/tasks.ts 抽离到这里。

import type { ArkClient } from './ark-client';
import type { FamilyMember, AiTaskDraft } from '../../src/domain/types';
import type { TaskDraftContext } from '../prompts';
import { buildTaskDraftPrompt, buildRepairPrompt } from '../prompts';
import { ModelOutputError, parseTaskDraftOutput } from './model-json';

export interface TaskModelDeps {
  arkClient: ArkClient;
}

export async function generateTaskDraft(
  arkClient: ArkClient,
  ctx: TaskDraftContext
): Promise<AiTaskDraft> {
  const prompt = buildTaskDraftPrompt(ctx);
  const raw = await arkClient.chat([{ type: 'text', text: prompt }]);

  try {
    return parseTaskDraftOutput(raw);
  } catch (firstError) {
    if (!(firstError instanceof ModelOutputError)) throw firstError;
    // 自动修复一次
    const repaired = await arkClient.chat([
      { type: 'text', text: buildRepairPrompt(raw, firstError.issues) }
    ]);
    return parseTaskDraftOutput(repaired);
  }
}
