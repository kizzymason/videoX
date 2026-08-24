import { describe, expect, it } from 'vitest';
import { buildSeoPrompt, parseSeoAiResponse } from '../apps/api/src/modules/seo/ai-optimizer.ts';

describe('SEO AI 提示词', () => {
  it('包含视频与站点上下文', () => {
    const messages = buildSeoPrompt({
      title: '测试视频',
      description: '一段简介',
      categoryName: '电影',
      tags: ['动作', '高清'],
      siteName: 'PandaGV',
      siteKeywords: '在线视频',
      siteContext: '面向华语用户',
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    const user = messages[1]!.content;
    expect(user).toContain('测试视频');
    expect(user).toContain('电影');
    expect(user).toContain('动作、高清');
    expect(user).toContain('PandaGV');
    expect(user).toContain('面向华语用户');
  });

  it('可选字段缺省时不输出空行', () => {
    const messages = buildSeoPrompt({
      title: '标题',
      description: null,
      categoryName: null,
      tags: [],
      siteName: 'PandaGV',
      siteKeywords: '',
      siteContext: '',
    });
    expect(messages[1]!.content).not.toContain('已有标签');
    expect(messages[1]!.content).not.toContain('视频简介');
  });
});

describe('SEO AI 输出解析', () => {
  it('解析纯 JSON', () => {
    const result = parseSeoAiResponse(
      JSON.stringify({ title: 'SEO 标题', description: '描述内容', keywords: ['词1', '词2'] }),
    );
    expect(result.seoTitle).toBe('SEO 标题');
    expect(result.seoDescription).toBe('描述内容');
    expect(result.keywords).toEqual(['词1', '词2']);
  });

  it('容忍 markdown 代码块与前后闲话', () => {
    const content = '好的，以下是结果：\n```json\n{"title":"T","description":"D","keywords":["k"]}\n```\n希望有帮助';
    const result = parseSeoAiResponse(content);
    expect(result.seoTitle).toBe('T');
    expect(result.keywords).toEqual(['k']);
  });

  it('关键词去重、去空并限制数量', () => {
    const keywords = Array.from({ length: 30 }, (_, i) => `词${i % 10}`);
    const result = parseSeoAiResponse(JSON.stringify({ title: 'T', description: 'D', keywords }));
    expect(result.keywords).toHaveLength(10);
    expect(new Set(result.keywords).size).toBe(10);
  });

  it('超长字段截断而不是报错', () => {
    const result = parseSeoAiResponse(
      JSON.stringify({ title: 'x'.repeat(300), description: 'y'.repeat(600), keywords: ['k'] }),
    );
    expect(result.seoTitle).toHaveLength(200);
    expect(result.seoDescription).toHaveLength(500);
  });

  it('没有 JSON 时抛错', () => {
    expect(() => parseSeoAiResponse('抱歉我不能完成该任务')).toThrow();
  });
});
