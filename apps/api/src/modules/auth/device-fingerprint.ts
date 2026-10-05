/**
 * 注册防护的纯计算部分：指纹、IP 归一化、提示文案。
 *
 * 单独成文件是为了能脱离数据库与环境变量做单测——判定逻辑本身与 IO 无关。
 */
import { createHash, createHmac } from 'node:crypto';
import type { DeviceSignals } from '@videox/shared';

/** 设备 id 的 cookie 名（服务端下发，HttpOnly，前端读不到也不需要读）。 */
export const DEVICE_COOKIE = 'videox_dv';

/** 重复注册的提示（指定文案）。 */
export const REGISTER_BLOCKED_MESSAGE = '设备已注册请登录';

/** 同一 IP 重复注册的提示：与设备文案区分，避免让共享网络的人以为是设备问题。 */
export const REGISTER_IP_BLOCKED_MESSAGE = '当前网络已注册过账号，请登录或更换网络';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function signDeviceSeed(seed: string, secret: string): string {
  return createHmac('sha256', secret).update(seed).digest('base64url').slice(0, 32);
}

/** IPv4 原样精确；IPv6 取 /64 —— 同一户运营商分到的通常是同一段，逐位比会漏。 */
export function ipFingerprint(ip: string): string {
  const value = ip.trim();
  if (!value) return '';
  if (!value.includes(':')) return value;
  const parts = value.split(':');
  return parts.slice(0, 4).join(':') + '::/64';
}

function normalizedSignals(signals: DeviceSignals): string {
  return [
    signals.platform,
    signals.screen,
    signals.tz,
    signals.lang,
    String(signals.cores),
    String(signals.memory),
    String(signals.touch),
    signals.gpu,
  ].join('|');
}

/** 浏览器信号 + UA：换个 cookie 也躲不掉。 */
export function signalFingerprint(userAgent: string, signals: DeviceSignals): string {
  return sha256('vx-sig-v1|' + userAgent.slice(0, 300) + '|' + normalizedSignals(signals));
}

/** 信号 + 服务端下发的设备 cookie：同一浏览器更精确。 */
export function deviceFingerprint(seed: string, userAgent: string, signals: DeviceSignals): string {
  return sha256('vx-dev-v1|' + seed + '|' + signalFingerprint(userAgent, signals));
}

/** 前端是否真的报了信号；一片空白时不做设备判定，只靠 IP。 */
export function hasDeviceSignals(signals: DeviceSignals): boolean {
  return Boolean(
    signals.platform || signals.screen || signals.tz || signals.lang || signals.gpu || signals.cores || signals.memory || signals.touch,
  );
}
