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

// ---------- Task 7（PRD v1.1）：意图 → 任务草稿 + 自动分配 ----------

export interface TaskDraftContext {
  rawInput: string;
  members: Array<{
    member_id: string;
    display_name: string;
    role: string;
    experience?: string;
    available_slots: string[];
    limitations: string[];
    preference: string;
    temporary_unavailable: boolean;
  }>;
  currentTime: string;
  dailyLoadMinutes?: Record<string, number>;
}

export function buildTaskDraftPrompt(ctx: TaskDraftContext): string {
  const memberLines = ctx.members
    .map(
      (m) =>
        `- id=${m.member_id} 称呼=${m.display_name} 身份=${m.role} 经验=${m.experience ?? '未知'} ` +
        `可用时段=[${m.available_slots.join(',') || '未知'}] 限制=[${m.limitations.join(',') || '无'}] ` +
        `偏好=${m.preference} 临时不可用=${m.temporary_unavailable ? '是' : '否'} ` +
        `今日已分配=${ctx.dailyLoadMinutes?.[m.member_id] ?? 0}分钟`
    )
    .join('\n');

  return `你是一名新生儿家庭协作助手。用户用一句话描述了一件需要家庭完成的护理事项，请把它转化为一个结构化的家庭任务，并指定最合适的负责人。

当前时间：${ctx.currentTime}
用户原文：${ctx.rawInput}

家庭成员：
${memberLines}

分配优先级（严格遵守先后顺序）：
1. 用户原文明确点名的成员优先。
2. 不得违反硬性限制（如不可夜间照护、不可弯腰）；临时不可用的成员不得分配。
3. 匹配可用时段与经验。
4. 当天已分配任务少的成员优先。
5. 参考成员偏好。
没有任何成员合适时，assignee_member_id 填 null（表示待认领），不得编造成员 id。

其他要求：
- 只输出一个 JSON 对象，不要输出解释文字或代码围栏。
- title 是简短任务名（50 字以内），不要照抄原文。
- completion_criteria 描述"做到什么程度算完成"（300 字以内）。
- assignment_reason 必须说明具体原因（150 字以内），不允许只写"AI 推荐"。
- subtasks 给出 2-6 个可勾选的执行子步骤，按顺序排列；若事项很简单可给空数组 []。
- 涉及疾病诊断、用药、异常症状的内容：不要扩写医疗操作步骤（subtasks 给 []），只在 safety_notice 中提示暂停并咨询专业医护人员；safety_notice 不需要时填 null。
- knowledge_notes 填 []（知识库补充由独立模块处理）。
- due_at 为 ISO 8601 时间（含时区），根据当前时间和事项紧急程度推断；无法推断填 null。

JSON 结构（严格遵守字段名与类型）：
{
  "title": "任务名",
  "assignee_member_id": "成员 id 或 null",
  "due_at": "2026-07-21T20:00:00+08:00 或 null",
  "duration_min": 15,
  "completion_criteria": "完成标准",
  "assignment_reason": "分配原因",
  "knowledge_notes": [],
  "safety_notice": "安全提示或 null",
  "subtasks": [
    { "title": "子步骤", "order": 1, "required": true, "source": "ai" }
  ]
}`;
}
