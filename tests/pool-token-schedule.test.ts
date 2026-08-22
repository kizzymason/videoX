import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES,
  isSourceAuthCode,
  isSourceAuthFailure,
  nextHealthCheckAt,
  resolveHealthCheckIntervalMinutes,
  tokenFreshnessFromCheck,
} from '../apps/api/src/modules/collection/pool-schedule.ts';
import { collectionSettingsPatchSchema } from '../apps/api/src/modules/collection/settings-schema.ts';

describe('号池巡检间隔', () => {
  it('默认 10 分钟，并夹紧到 1–120', () => {
    expect(DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES).toBe(10);
    expect(resolveHealthCheckIntervalMinutes(undefined)).toBe(10);
    expect(resolveHealthCheckIntervalMinutes(0)).toBe(1);
    expect(resolveHealthCheckIntervalMinutes(7.8)).toBe(7);
    expect(resolveHealthCheckIntervalMinutes(240)).toBe(120);
    expect(resolveHealthCheckIntervalMinutes(10)).toBe(10);
  });

  it('设置接口允许 1 分钟间隔，拒绝超出范围', () => {
    expect(collectionSettingsPatchSchema.parse({ pool: { healthCheckIntervalMinutes: 1 } }).pool?.healthCheckIntervalMinutes).toBe(1);
    expect(collectionSettingsPatchSchema.parse({ pool: { healthCheckIntervalMinutes: 10 } }).pool?.healthCheckIntervalMinutes).toBe(10);
    expect(() => collectionSettingsPatchSchema.parse({ pool: { healthCheckIntervalMinutes: 0 } })).toThrow();
    expect(() => collectionSettingsPatchSchema.parse({ pool: { healthCheckIntervalMinutes: 121 } })).toThrow();
  });
});

describe('token 有效性按 /me 巡检，不按猜测寿命', () => {
  const now = Date.parse('2026-08-22T06:00:00.000Z');

  it('从未巡检为 unknown，间隔内为 fresh，超过间隔为 due，两倍间隔为 stale', () => {
    expect(tokenFreshnessFromCheck(null, 10, now)).toBe('unknown');
    expect(tokenFreshnessFromCheck(new Date(now - 9 * 60_000), 10, now)).toBe('fresh');
    expect(tokenFreshnessFromCheck(new Date(now - 10 * 60_000), 10, now)).toBe('due');
    expect(tokenFreshnessFromCheck(new Date(now - 20 * 60_000), 10, now)).toBe('stale');
  });

  it('下次巡检 = 上次 /me + 间隔', () => {
    expect(nextHealthCheckAt(new Date(now - 3 * 60_000), 10)?.toISOString()).toBe(
      new Date(now + 7 * 60_000).toISOString(),
    );
    expect(nextHealthCheckAt(null, 10)).toBeNull();
  });

  it('识别源站鉴权失败，避免把普通业务错误当成 token 过期', () => {
    expect(isSourceAuthCode('401')).toBe(true);
    expect(isSourceAuthCode(403)).toBe(true);
    expect(isSourceAuthCode('200')).toBe(false);
    expect(isSourceAuthFailure(new Error('API request failed: 401 Unauthorized'))).toBe(true);
    expect(isSourceAuthFailure(new Error('源站返回异常: 401 token 失效'))).toBe(true);
    expect(isSourceAuthFailure(new Error('源站列表 API 异常: 500 timeout'))).toBe(false);
  });
});
