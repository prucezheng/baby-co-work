// 三类模型 Prompt：视频理解 / 修复 / （Task 7 规划、Task 9 调整后续追加）

export const VIDEO_ANALYSIS_PROMPT = `你是一名新生儿护理视频结构化助手。请理解这条视频的画面、音频与文字信息，整理为可执行的护理步骤。

要求：
1. 只输出一个 JSON 对象，不要输出任何解释文字或 Markdown 代码围栏。
2. 步骤最多 10 步，按操作顺序排列。
3. 每一步必须给出在视频中的来源时间点 startSec / endSec（秒，整数）；无法确定时间点时填 null。
4. 你不确定的内容写入 uncertainties 数组，禁止编造。
5. 涉及疾病诊断、药物剂量、异常症状判断或危险操作的内容，该步骤 riskLevel 必须填 "medical"，并在 caution 中建议咨询专业医护人员。
6. 如果视频与新生儿护理无关，将 topic 填为 "非新生儿护理内容"，steps 只保留一条说明。

JSON 结构（严格遵守字段名与类型）：
{
  "videoId": "由系统覆盖，填任意字符串",
  "topic": "视频主题，100 字以内",
  "applicableScene": "适用场景，100 字以内",
  "supplies": ["所需物品，每项 30 字以内"],
  "cautions": ["整体注意事项"],
  "uncertainties": ["你不确定、需要用户确认的内容"],
  "steps": [
    {
      "id": "step-1",
      "order": 1,
      "title": "步骤标题，50 字以内",
      "instruction": "操作说明，500 字以内",
      "startSec": 0,
      "endSec": 10,
      "supplies": ["该步骤所需物品"],
      "caution": "该步骤注意事项，300 字以内，无则填空字符串",
      "riskLevel": "low 或 confirm 或 medical",
      "userConfirmed": false
    }
  ]
}`;

// 结构校验失败后的单次修复 Prompt：给出原始输出与 Zod 错误，要求只修正结构
export function buildRepairPrompt(rawOutput: string, issues: unknown): string {
  return `你上一次输出的内容未通过结构校验。请只修正结构问题，保持护理内容不变，重新输出完整 JSON。

结构错误：
${JSON.stringify(issues, null, 2)}

你上一次的输出：
${rawOutput}

要求：只输出修正后的 JSON 对象，不要输出解释或代码围栏。`;
}
