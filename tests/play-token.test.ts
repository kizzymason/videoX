import { describe, expect, it, vi } from 'vitest';
import {
  deriveHlsContentKey,
  deriveHlsIv,
  hashUserAgent,
  normalizeIpPrefix,
  playTokenRemainingRatio,
  signPlayToken,
  verifyPlayToken,
} from '@videox/shared/play-token';

const SECRET = 'test-secret-please-change';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140';

const sign = (overrides: Partial<Parameters<typeof signPlayToken>[0]> = {}) =>
  signPlayToken({
    videoId: 'video-1',
    userId: 'user-1',
    ttlSeconds: 600,
    ip: '203.0.113.42',
    userAgent: UA,
    secret: SECRET,
    ...overrides,
  });

const verify = (token: string, overrides: Partial<Parameters<typeof verifyPlayToken>[0]> = {}) =>
  verifyPlayToken({
    token,
    secret: SECRET,
    expectedVideoId: 'video-1',
    ip: '203.0.113.42',
    userAgent: UA,
    ...overrides,
  });

describe('playToken 签发与校验', () => {
  it('正常签发的令牌可以通过校验并还原全部声明', () => {
    const { token, claims } = sign();
    const result = verify(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toEqual(claims);
    expect(result.claims.scope).toBe('full');
    expect(result.claims.userId).toBe('user-1');
  });

  it('令牌形如 v1.<payload>.<signature>', () => {
    const { token } = sign();
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith('v1.')).toBe(true);
  });

  it('同一秒连续签发两次也不会得到相同令牌', () => {
    expect(sign().token).not.toBe(sign().token);
  });

  it('游客签发时 userId 落为 anon', () => {
    expect(sign({ userId: null }).claims.userId).toBe('anon');
  });

  it('ttl 有 30 秒下限，避免签出立刻就过期的票', () => {
    expect(sign({ ttlSeconds: 1 }).ttlSeconds).toBe(30);
  });
});

describe('playToken 拒绝非法请求', () => {
  it('空令牌与结构不完整的令牌都算 malformed', () => {
    for (const token of ['', '   ', 'garbage', 'v1.only-two']) {
      const result = verify(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('malformed');
    }
  });

  it('版本号不匹配直接拒绝', () => {
    const { token } = sign();
    const result = verify(token.replace(/^v1\./, 'v2.'));
    expect(result).toEqual({ ok: false, reason: 'bad_version' });
  });

  it('换个密钥签的令牌验不过', () => {
    const { token } = sign();
    const result = verifyPlayToken({ token, secret: 'another-secret', ip: '203.0.113.42', userAgent: UA });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('篡改 payload 后签名校验失败——这是防盗链的核心断言', () => {
    const { token } = sign({ scope: 'preview' });
    const [version, payload, signature] = token.split('.');
    // 把 scope 从 preview 改成 full，试图绕过试看门禁
    const tampered = Buffer.from(payload!, 'base64url').toString('utf8').replace('|preview', '|full');
    const forged = `${version}.${Buffer.from(tampered, 'utf8').toString('base64url')}.${signature}`;

    const result = verify(forged);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('过期令牌被拒，且允许的时钟偏移不会把它救回来', () => {
    const { token } = sign({ ttlSeconds: 30 });
    // 跳到 TTL 之后再加上超过默认 5 秒偏移的时间
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 40_000);
      expect(verify(token)).toEqual({ ok: false, reason: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('拿 A 视频的票去请求 B 视频会被拒', () => {
    const { token } = sign({ videoId: 'video-A' });
    const result = verify(token, { expectedVideoId: 'video-B' });
    expect(result).toEqual({ ok: false, reason: 'video_mismatch' });
  });

  it('换到别的网段会被拒，同网段内换末位不受影响', () => {
    const { token } = sign({ ip: '203.0.113.42' });

    expect(verify(token, { ip: '198.51.100.7' })).toEqual({ ok: false, reason: 'ip_mismatch' });
    // 默认只绑定前三段，同一个 /24 里换末位仍然放行（移动网络常见）
    expect(verify(token, { ip: '203.0.113.99' }).ok).toBe(true);
  });

  it('换浏览器会被拒', () => {
    const { token } = sign();
    const result = verify(token, { userAgent: 'curl/8.5.0' });
    expect(result).toEqual({ ok: false, reason: 'ua_mismatch' });
  });
});

describe('playToken 辅助函数', () => {
  it('normalizeIpPrefix 按段截断并剥掉 IPv4-mapped 前缀', () => {
    expect(normalizeIpPrefix('203.0.113.42', 3)).toBe('203.0.113');
    expect(normalizeIpPrefix('::ffff:203.0.113.42', 3)).toBe('203.0.113');
    expect(normalizeIpPrefix('2001:db8:85a3:1:2:3:4:5', 3)).toBe('2001:db8:85a3:1');
    expect(normalizeIpPrefix('203.0.113.42', 0)).toBe('');
    expect(normalizeIpPrefix(null, 3)).toBe('');
  });

  it('hashUserAgent 稳定且定长', () => {
    expect(hashUserAgent(UA)).toBe(hashUserAgent(UA));
    expect(hashUserAgent(UA)).toHaveLength(16);
    expect(hashUserAgent(UA)).not.toBe(hashUserAgent('curl/8.5.0'));
  });

  it('playTokenRemainingRatio 从 1 递减到 0 并被夹在区间内', () => {
    const { claims } = sign({ ttlSeconds: 600 });
    expect(playTokenRemainingRatio(claims, 600)).toBeGreaterThan(0.98);
    expect(playTokenRemainingRatio({ ...claims, exp: 0 }, 600)).toBe(0);
  });
});

describe('HLS 密钥派生', () => {
  it('密钥与 IV 都是 16 字节，且随 videoId 变化', () => {
    const key = deriveHlsContentKey('video-1', SECRET);
    const iv = deriveHlsIv('video-1', SECRET);

    expect(key).toHaveLength(16);
    expect(iv).toHaveLength(16);
    expect(key.equals(iv)).toBe(false);
    expect(deriveHlsContentKey('video-2', SECRET).equals(key)).toBe(false);
  });

  it('同样的输入永远派生出同样的密钥，因此不必落库', () => {
    expect(deriveHlsContentKey('video-1', SECRET).equals(deriveHlsContentKey('video-1', SECRET))).toBe(true);
  });

  it('主密钥换了，派生密钥也跟着换', () => {
    expect(deriveHlsContentKey('video-1', SECRET).equals(deriveHlsContentKey('video-1', 'other'))).toBe(false);
  });
});
