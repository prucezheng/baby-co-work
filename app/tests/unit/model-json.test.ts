import { describe, expect, it } from 'vitest';
import { ModelOutputError, parseAnalysisOutput } from '../../server/services/model-json';

describe('parseAnalysisOutput', () => {
  it('parses fenced JSON', () => {
    const raw =
      '```json\n{"videoId":"v1","topic":"用品准备","applicableScene":"睡前",' +
      '"supplies":[],"cautions":[],"uncertainties":[],"steps":[{"id":"s1","order":1,' +
      '"title":"整理用品","instruction":"将衣物放好","startSec":1,"endSec":8,"supplies":[],' +
      '"caution":"","riskLevel":"low","userConfirmed":false}]}\n```';
    expect(parseAnalysisOutput(raw, 'v1').topic).toBe('用品准备');
  });

  it('forces medicine instructions to medical risk', () => {
    const raw =
      '{"videoId":"v1","topic":"护理","applicableScene":"日常","supplies":[],' +
      '"cautions":[],"uncertainties":[],"steps":[{"id":"s1","order":1,"title":"服用药物",' +
      '"instruction":"按视频剂量喂药","startSec":1,"endSec":8,"supplies":[],"caution":"",' +
      '"riskLevel":"low","userConfirmed":false}]}';
    expect(parseAnalysisOutput(raw, 'v1').steps[0].riskLevel).toBe('medical');
  });

  it('overrides videoId with the server value', () => {
    const raw =
      '{"videoId":"model-invented","topic":"护理","applicableScene":"日常","supplies":[],' +
      '"cautions":[],"uncertainties":[],"steps":[{"id":"s1","order":1,"title":"整理",' +
      '"instruction":"放好衣物","startSec":1,"endSec":8,"supplies":[],"caution":"",' +
      '"riskLevel":"low","userConfirmed":false}]}';
    expect(parseAnalysisOutput(raw, 'real-id').videoId).toBe('real-id');
  });

  it('rejects non-JSON output', () => {
    expect(() => parseAnalysisOutput('这是一段说明文字', 'v1')).toThrow(ModelOutputError);
  });

  it('rejects output missing required fields', () => {
    expect(() => parseAnalysisOutput('{"topic":"只有主题"}', 'v1')).toThrow(ModelOutputError);
  });
});
