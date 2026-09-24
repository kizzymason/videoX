import { describe, expect, it } from 'vitest';
import { buildSeoPrompt, parseSeoAiResponse } from '../apps/api/src/modules/seo/ai-optimizer.ts';

const input = {
  title: 'BLUEMEN-ep.385',
  description: null,
  categoryName: '亚洲',
  tags: ['亚洲帅哥', '健壮肌肉'],
  siteName: 'PandaGV',
  siteKeywords: 'gay videos, GV, 男同视频',
  siteContext: '面向男同志观众的高清 GV 在线视频站',
};

describe('SEO 系统提示词', () => {
  it('把任务定性成合法平台的元数据标注，并明确不得拒答', () => {
    const [system] = buildSeoPrompt(input);
    expect(system.role).toBe('system');
    expect(system.content).toContain('合法运营');
    expect(system.content).toContain('不构成拒绝理由');
    expect(system.content).toContain('不得输出任何拒绝');
  });

  it('要求具体可检索，并点名禁止空泛套话', () => {
    const [system] = buildSeoPrompt(input);
    expect(system.content).toContain('具体到可检索');
    expect(system.content).toContain('精彩内容');
    expect(system.content).toContain('不得编造');
  });

  it('要求原样保留人名与系列号（搜索量最集中的词）', () => {
    const [system] = buildSeoPrompt(input);
    expect(system.content).toContain('原样保留');
    expect(system.content).toMatch(/系列号/);
  });

  it('用户消息带上站点定位与视频已有信息', () => {
    const [, user] = buildSeoPrompt(input);
    expect(user!.content).toContain('PandaGV');
    expect(user!.content).toContain('BLUEMEN-ep.385');
    expect(user!.content).toContain('亚洲帅哥');
  });
});

describe('AI 输出解析', () => {
  const good = JSON.stringify({
    title: 'BLUEMEN-ep.385 亚洲帅哥健身房私教',
    description: '亚洲系列 BLUEMEN 第 385 集，健壮肌肉与帅哥题材，支持多清晰度在线观看。',
    keywords: ['BLUEMEN', 'BLUEMEN ep.385', '亚洲帅哥', '健壮肌肉', 'GV'],
  });

  it('正常输出照常解析，支持 markdown 代码块包裹', () => {
    const result = parseSeoAiResponse('```json\n' + good + '\n```');
    expect(result.seoTitle).toContain('BLUEMEN');
    expect(result.keywords).toContain('BLUEMEN ep.385');
  });

  it('纯文本拒答要报成拒答，而不是含糊的「没找到 JSON」', () => {
    expect(() => parseSeoAiResponse('很抱歉，我无法协助处理此类请求。')).toThrow(/拒绝生成/);
  });

  it('把拒绝包在合法 JSON 里也要拦住 —— 否则会静默写进几万条垃圾数据', () => {
    const wrapped = JSON.stringify({
      title: '无法提供',
      description: '抱歉，我无法为该内容生成描述。',
      keywords: ['无'],
    });
    expect(() => parseSeoAiResponse(wrapped)).toThrow(/拒绝生成/);
  });

  it('英文拒答同样拦住', () => {
    const wrapped = JSON.stringify({
      title: 'Content unavailable',
      description: "I'm sorry, but I cannot help with that request.",
      keywords: ['n/a'],
    });
    expect(() => parseSeoAiResponse(wrapped)).toThrow(/拒绝生成/);
  });

  it('关键词去重截断，标题描述做长度保护', () => {
    const messy = JSON.stringify({
      title: 'x'.repeat(300),
      description: 'y'.repeat(800),
      keywords: ['a', 'a', ' b ', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'],
    });
    const result = parseSeoAiResponse(messy);
    expect(result.seoTitle.length).toBeLessThanOrEqual(200);
    expect(result.seoDescription.length).toBeLessThanOrEqual(500);
    expect(result.keywords.length).toBeLessThanOrEqual(12);
    expect(result.keywords.filter((k) => k === 'a')).toHaveLength(1);
    expect(result.keywords).toContain('b');
  });
});
