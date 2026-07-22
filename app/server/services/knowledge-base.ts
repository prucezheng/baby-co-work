// 知识库检索：基于关键词匹配，为任务补充步骤、注意事项和安全提示。
// 只增强不改变原始意图，医疗相关内容不扩写操作步骤。
// 种子数据内联为常量，避免文件 I/O 在测试和 serverless 环境中的路径问题。

import type { KnowledgeNote } from '../../src/domain/types';

export interface KnowledgeEnhancement {
  notes: Array<{ text: string; kind: KnowledgeNote['kind']; sourceEntryId: string }>;
}

interface KnowledgeEntry {
  id: string;
  keywords: string[];
  text: string;
  kind: KnowledgeNote['kind'];
}

// 内联种子数据（与 server/data/knowledge-base.seed.json 保持同步）
const SEED_ENTRIES: KnowledgeEntry[] = [
  {
    id: 'kb-sleep-setup',
    keywords: ['睡前', '准备', '用品', '衣物', '纸尿裤', '毛巾', '护理台'],
    text: '检查用品是否洁净并放在伸手可及处，避免护理中途离开宝宝。',
    kind: 'preparation'
  },
  {
    id: 'kb-room-check',
    keywords: ['室温', '环境', '灯光', '温度', '安静', '睡眠'],
    text: '保持室温24-26度，灯光调暗，减少噪音干扰。',
    kind: 'notice'
  },
  {
    id: 'kb-head-support',
    keywords: ['头颈', '颈部', '托住', '抱', '翻身'],
    text: '操作全程托住宝宝头颈部，新生儿颈部肌肉尚未发育完全。',
    kind: 'safety'
  },
  {
    id: 'kb-feeding-position',
    keywords: ['喂奶', '吃完', '奶', '平躺', '右侧卧', '吐奶'],
    text: '喂奶后保持右侧卧位30分钟再平躺，可防呛咳和偏头型。',
    kind: 'safety'
  },
  {
    id: 'kb-diaper-change',
    keywords: ['纸尿裤', '换尿布', '尿布', '侧身', '抬高'],
    text: '通过侧身操作更换纸尿裤，避免抬高宝宝臀部造成吐奶或髋关节损伤。',
    kind: 'step'
  },
  {
    id: 'kb-bath-temp',
    keywords: ['洗澡', '水温', '沐浴', '清洁', '洗'],
    text: '洗澡水温控制在38-40度，先用手肘试温，全程不要离开宝宝。',
    kind: 'safety'
  },
  {
    id: 'kb-umbilical-care',
    keywords: ['脐带', '肚脐', '脐部', '消毒'],
    text: '脐带未脱落前保持干燥，每天用75%酒精棉签由内向外消毒。',
    kind: 'step'
  },
  {
    id: 'kb-night-feed',
    keywords: ['夜奶', '夜间', '半夜', '凌晨', '醒来'],
    text: '夜间喂奶保持微光即可，喂完立即关灯，帮助宝宝建立昼夜节律。',
    kind: 'notice'
  }
];

/** 根据原始输入文本匹配知识库条目 */
export async function enhanceWithKnowledge(
  rawInput: string,
  title: string
): Promise<KnowledgeEnhancement> {
  const text = `${rawInput} ${title}`;
  const matched = SEED_ENTRIES.filter((entry) =>
    entry.keywords.some((kw) => text.includes(kw))
  );

  // 去重：按 text 内容合并相同条目
  const seen = new Set<string>();
  const notes: KnowledgeEnhancement['notes'] = [];

  for (const entry of matched) {
    if (seen.has(entry.text)) continue;
    seen.add(entry.text);
    notes.push({
      text: entry.text,
      kind: entry.kind,
      sourceEntryId: entry.id
    });
  }

  return { notes };
}
