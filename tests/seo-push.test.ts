import { describe, expect, it } from 'vitest';
import {
  buildBaiduPushRequest,
  buildIndexNowRequest,
  chunk,
  generateIndexNowKey,
  isValidIndexNowKey,
  normalizeSiteOrigin,
  parseBaiduResponse,
  parseIndexNowResponse,
  toAbsoluteUrls,
} from '../apps/api/src/modules/seo/push/engines.ts';

describe('站点 URL 规范化', () => {
  it('去掉尾部斜杠', () => {
    expect(normalizeSiteOrigin('https://example.com/')).toBe('https://example.com');
    expect(normalizeSiteOrigin('https://example.com')).toBe('https://example.com');
  });

  it('相对路径拼上站点源，绝对 URL 保留', () => {
    const urls = toAbsoluteUrls(['/watch/abc', 'https://example.com/watch/def'], 'https://example.com/');
    expect(urls).toEqual(['https://example.com/watch/abc', 'https://example.com/watch/def']);
  });

  it('丢弃外站 URL、空值并去重', () => {
    const urls = toAbsoluteUrls(
      ['https://evil.com/x', '', '/watch/a', '/watch/a', 'watch/b'],
      'https://example.com',
    );
    expect(urls).toEqual(['https://example.com/watch/a', 'https://example.com/watch/b']);
  });
});

describe('IndexNow', () => {
  it('生成的 key 合法', () => {
    const key = generateIndexNowKey();
    expect(key).toHaveLength(32);
    expect(isValidIndexNowKey(key)).toBe(true);
  });

  it('拒绝非法 key', () => {
    expect(isValidIndexNowKey('short')).toBe(false);
    expect(isValidIndexNowKey('包含中文的key123')).toBe(false);
  });

  it('构建符合协议的请求体', () => {
    const request = buildIndexNowRequest('https://example.com/', 'abc12345', ['https://example.com/watch/x']);
    expect(request.endpoint).toBe('https://api.indexnow.org/indexnow');
    expect(request.payload).toEqual({
      host: 'example.com',
      key: 'abc12345',
      keyLocation: 'https://example.com/abc12345.txt',
      urlList: ['https://example.com/watch/x'],
    });
  });

  it('200/202 算受理成功，403 提示 key 问题', () => {
    expect(parseIndexNowResponse(200, '').ok).toBe(true);
    expect(parseIndexNowResponse(202, '').ok).toBe(true);
    const forbidden = parseIndexNowResponse(403, '');
    expect(forbidden.ok).toBe(false);
    expect(forbidden.message).toContain('key');
  });
});

describe('百度推送', () => {
  it('site 与 token 拼进查询串，正文按行分隔', () => {
    const request = buildBaiduPushRequest('https://example.com/', 'tok123', [
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(request.url).toBe('http://data.zz.baidu.com/urls?site=https%3A%2F%2Fexample.com&token=tok123');
    expect(request.body).toBe('https://example.com/a\nhttps://example.com/b');
  });

  it('解析成功响应里的 success/remain', () => {
    const parsed = parseBaiduResponse(200, JSON.stringify({ success: 2, remain: 98 }));
    expect(parsed.ok).toBe(true);
    expect(parsed.remain).toBe(98);
    expect(parsed.message).toContain('2');
  });

  it('解析失败响应里的 message', () => {
    const parsed = parseBaiduResponse(401, JSON.stringify({ error: 401, message: 'token is not valid' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('token is not valid');
  });

  it('非 JSON 响应按失败处理', () => {
    expect(parseBaiduResponse(200, 'not json').ok).toBe(false);
  });
});

describe('分批', () => {
  it('按批量大小切分', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});
