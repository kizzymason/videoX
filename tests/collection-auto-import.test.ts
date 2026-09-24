import { describe, expect, it } from 'vitest';
import {
  AUTO_IMPORT_BATCH_MAX,
  DEFAULT_AUTO_IMPORT_CONFIG,
  classifyImportFailure,
  normalizeAutoImportConfig,
  shouldGiveUpImport,
} from '../packages/shared/src/index.ts';

describe('采集自动导入 - 失败分类', () => {
  it('源站已经没有这条片子：判死，不再重试', () => {
    // 线上真实报错：热链取址时源站 play 接口直接 404
    expect(classifyImportFailure('API request failed: 404 Not Found')).toBe('permanent');
    expect(classifyImportFailure('源站返回异常: 404 not found')).toBe('permanent');
    expect(classifyImportFailure('采集视频记录不存在: abc')).toBe('permanent');
    expect(classifyImportFailure('该资源已下架')).toBe('permanent');
  });

  it('源站抖动 / 号池没号：留着下一轮再试', () => {
    expect(classifyImportFailure('源站 play API 异常: 503 video metadata transient, please retry')).toBe('transient');
    expect(classifyImportFailure('API request failed: 500 Internal Server Error')).toBe('transient');
    expect(classifyImportFailure('号池中无可用账号，无法获取热链地址')).toBe('transient');
    expect(classifyImportFailure('fetch failed')).toBe('transient');
    expect(classifyImportFailure('ETIMEDOUT')).toBe('transient');
    expect(classifyImportFailure('说不清的错误')).toBe('transient');
  });

  it('外部 ID 里的数字不能被当成状态码', () => {
    // 1000004403 里带 404、1000005000 里带 500，都不该左右判定
    expect(classifyImportFailure('导入 1000004403 时发生未知错误')).toBe('transient');
    expect(classifyImportFailure('videoId 1000005000 状态异常')).toBe('transient');
  });

  it('临时错误攒到上限也要放弃，否则会永远堵住待导入队列', () => {
    const message = '源站 play API 异常: 503 transient';
    expect(shouldGiveUpImport({ message, attempts: 1, maxAttempts: 3 })).toBe(false);
    expect(shouldGiveUpImport({ message, attempts: 3, maxAttempts: 3 })).toBe(true);
    // 永久错误第一次就放弃
    expect(shouldGiveUpImport({ message: '404 Not Found', attempts: 1, maxAttempts: 3 })).toBe(true);
  });
});

describe('采集自动导入 - 配置归一', () => {
  it('空配置回落到默认值：默认开启自动导入', () => {
    expect(normalizeAutoImportConfig(undefined)).toEqual(DEFAULT_AUTO_IMPORT_CONFIG);
    expect(normalizeAutoImportConfig({}).enabled).toBe(true);
  });

  it('越界与脏数据都被夹回合法范围', () => {
    const config = normalizeAutoImportConfig({
      batchSize: 9999,
      intervalMinutes: 0,
      maxAttempts: 999,
      forceMode: 'nonsense',
      enabled: false,
    });
    expect(config.batchSize).toBe(AUTO_IMPORT_BATCH_MAX);
    expect(config.intervalMinutes).toBe(1);
    expect(config.maxAttempts).toBe(10);
    expect(config.forceMode).toBe('auto');
    expect(config.enabled).toBe(false);
  });

  it('字符串数字也能接受（表单传上来常是字符串）', () => {
    const config = normalizeAutoImportConfig({ batchSize: '25', intervalMinutes: '30' });
    expect(config.batchSize).toBe(25);
    expect(config.intervalMinutes).toBe(30);
  });
});
