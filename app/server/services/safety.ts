// 医疗安全关键词：命中即把步骤风险升级为 medical，绝不生成可直接执行任务
// 覆盖 PRD 第 10.1 节：诊断、用药、紧急情况、危险操作
const MEDICAL_KEYWORDS = [
  // 用药与诊断
  '用药',
  '喂药',
  '药物',
  '药剂',
  '剂量',
  '处方',
  '停药',
  '抗生素',
  '退烧药',
  '诊断',
  // 异常症状与紧急情况
  '窒息',
  '呼吸困难',
  '呼吸异常',
  '高热',
  '发烧',
  '发热',
  '持续呕吐',
  '意识不清',
  '意识异常',
  '抽搐',
  '急诊',
  '就医',
  '救护车',
  // 危险操作
  '烫伤',
  '跌落',
  '坠床'
];

export function containsMedicalRisk(text: string): boolean {
  if (!text) return false;
  return MEDICAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

// 对单个步骤做关键词风险升级：标题/说明/注意事项任一命中即强制 medical
export function upgradeStepRisk<T>(step: T): T {
  if (step === null || typeof step !== 'object') return step;
  const record = step as Record<string, unknown>;
  const text = [record.title, record.instruction, record.caution]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
  if (!containsMedicalRisk(text)) return step;
  return { ...record, riskLevel: 'medical' } as T;
}
