/**
 * 注册防护：指纹计算与文案。
 *
 * 判定逻辑是纯函数，这里只测它能区分不同设备/不同网络、同一设备稳定，
 * 以及 IP 归一化（IPv4 精确、IPv6 收敛到 /64）。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_DEVICE_SIGNALS, deviceSignalsSchema } from '../packages/shared/src/device-signals.ts';
import {
  REGISTER_BLOCKED_MESSAGE,
  deviceFingerprint,
  hasDeviceSignals,
  ipFingerprint,
  signalFingerprint,
} from '../apps/api/src/modules/auth/device-fingerprint.ts';

const phone = {
  platform: 'iPhone',
  screen: '390x844x3',
  tz: 'Asia/Shanghai',
  lang: 'zh-CN',
  cores: 6,
  memory: 0,
  touch: 5,
  gpu: 'Apple GPU',
};
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';

describe('注册防护指纹', () => {
  it('同一设备同一浏览器稳定，换设备或换系统就不同', () => {
    expect(signalFingerprint(ua, phone)).toBe(signalFingerprint(ua, { ...phone }));
    expect(signalFingerprint(ua, phone)).not.toBe(signalFingerprint(ua, { ...phone, platform: 'Linux armv8l' }));
    expect(signalFingerprint(ua, phone)).not.toBe(signalFingerprint(ua, { ...phone, cores: 8 }));
    expect(signalFingerprint(ua, phone)).not.toBe(signalFingerprint(ua + ' Chrome/130', phone));
  });

  it('设备指纹叠加服务端 cookie：清 cookie 换设备键，信号键不变', () => {
    const withSeed = deviceFingerprint('seed-a', ua, phone);
    expect(withSeed).not.toBe(deviceFingerprint('seed-b', ua, phone));
    expect(withSeed).toBe(deviceFingerprint('seed-a', ua, { ...phone }));
    expect(withSeed).not.toBe(signalFingerprint(ua, phone));
  });

  it('空信号不算设备，只靠 IP 兜底', () => {
    expect(hasDeviceSignals(EMPTY_DEVICE_SIGNALS)).toBe(false);
    expect(hasDeviceSignals(phone)).toBe(true);
  });

  it('IPv4 精确匹配，IPv6 收敛到 /64', () => {
    expect(ipFingerprint(' 1.2.3.4 ')).toBe('1.2.3.4');
    expect(ipFingerprint('1.2.3.4')).not.toBe(ipFingerprint('1.2.3.5'));
    expect(ipFingerprint('2408:8207:1234:5678:aaaa:bbbb:cccc:dddd')).toBe('2408:8207:1234:5678::/64');
    expect(ipFingerprint('2408:8207:1234:5678:1111::1')).toBe(ipFingerprint('2408:8207:1234:5678:2222::2'));
    expect(ipFingerprint('')).toBe('');
  });

  it('提示文案与入参校验符合约定', () => {
    expect(REGISTER_BLOCKED_MESSAGE).toBe('设备已注册请登录');
    expect(() => deviceSignalsSchema.parse({ ...phone, extra: 'x' })).toThrow();
    expect(deviceSignalsSchema.parse({}).screen).toBe('');
  });
});
