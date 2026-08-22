import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES,
  isTokenDueForRefresh,
  resolveHealthCheckIntervalMinutes,
  selectAccountsDueForTokenRefresh,
  TOKEN_SILENT_REFRESH_MS,
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

describe('到期 token 选择', () => {
  const now = Date.parse('2026-08-22T06:00:00.000Z');

  it('从未写入或超过 4 分钟视为到期', () => {
    expect(isTokenDueForRefresh(null, now)).toBe(true);
    expect(isTokenDueForRefresh(new Date(now - TOKEN_SILENT_REFRESH_MS), now)).toBe(true);
    expect(isTokenDueForRefresh(new Date(now - TOKEN_SILENT_REFRESH_MS + 1), now)).toBe(false);
  });

  it('只挑有密码、未封禁且到期的账号', () => {
    const due = selectAccountsDueForTokenRefresh(
      [
        {
          id: 'fresh',
          status: 'active',
          loginUsername: 'a',
          loginPasswordEncrypted: 'x',
          tokenUpdatedAt: new Date(now - 60_000),
        },
        {
          id: 'due',
          status: 'inactive',
          loginUsername: 'b',
          loginPasswordEncrypted: 'y',
          tokenUpdatedAt: new Date(now - TOKEN_SILENT_REFRESH_MS),
        },
        {
          id: 'banned',
          status: 'banned',
          loginUsername: 'c',
          loginPasswordEncrypted: 'z',
          tokenUpdatedAt: null,
        },
        {
          id: 'static',
          status: 'active',
          loginUsername: null,
          loginPasswordEncrypted: null,
          tokenUpdatedAt: new Date(now - TOKEN_SILENT_REFRESH_MS * 3),
        },
      ],
      now,
    );
    expect(due.map((item) => item.id)).toEqual(['due']);
  });
});
