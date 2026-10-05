/**
 * 注册防护：设备指纹 + IP 双重限制。
 *
 * 规则：同一设备、同一 IP 在窗口（默认 1095 天）内各只能注册一次，重复注册直接拒绝并提示
 * 「设备已注册请登录」。这里防的是自动化批量注册，不是防人注册，所以没有滑块。
 *
 * 判定与写入都在服务端：前端只提供原始信号；清 cookie 会换掉 device 指纹，
 * 但 signal 指纹仍由浏览器信号与 UA 决定，改不了结论。
 */
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { DeviceSignals } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import {
  DEVICE_COOKIE,
  REGISTER_BLOCKED_MESSAGE,
  REGISTER_IP_BLOCKED_MESSAGE,
  deviceFingerprint,
  hasDeviceSignals,
  ipFingerprint,
  signDeviceSeed,
  signalFingerprint,
} from './device-fingerprint.js';

/** 浏览器对 Cookie 有效期有上限，真正的窗口由数据库的 expires_at 决定。 */
const DEVICE_COOKIE_DAYS = 400;

function readCookie(req: Request, name: string): string {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
  return typeof raw === 'string' ? raw : '';
}

/** 读出服务端下发的设备种子；签名不对或没有就当没有。 */
export function readDeviceSeed(req: Request): string {
  const raw = readCookie(req, DEVICE_COOKIE);
  const [seed, mac] = raw.split('.');
  if (!seed || !mac) return '';
  const expected = signDeviceSeed(seed, env.COOKIE_SECRET);
  if (mac.length !== expected.length) return '';
  let diff = 0;
  for (let i = 0; i < mac.length; i += 1) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? seed : '';
}

export function ensureDeviceSeed(req: Request, res: Response): string {
  const existing = readDeviceSeed(req);
  if (existing) return existing;
  const seed = randomBytes(16).toString('base64url');
  res.cookie(DEVICE_COOKIE, seed + '.' + signDeviceSeed(seed, env.COOKIE_SECRET), {
    httpOnly: true,
    // 三个前端与 API 同站不同源，lax 足够；strict 会在部分导航场景丢 cookie。
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/',
    maxAge: DEVICE_COOKIE_DAYS * 86_400_000,
  });
  return seed;
}

export interface RegisterGuardSettings {
  enabled: boolean;
  windowDays: number;
  deviceLimit: number;
  ipLimit: number;
}

export function guardSettingsFrom(settings: {
  registerGuardEnabled: boolean;
  registerGuardWindowDays: number;
  registerDeviceLimit: number;
  registerIpLimit: number;
}): RegisterGuardSettings {
  return {
    enabled: settings.registerGuardEnabled,
    windowDays: settings.registerGuardWindowDays,
    deviceLimit: settings.registerDeviceLimit,
    ipLimit: settings.registerIpLimit,
  };
}

async function countWithin(kind: 'signal' | 'device' | 'ip', fingerprint: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(t.registerGuards)
    .where(
      and(
        eq(t.registerGuards.kind, kind),
        eq(t.registerGuards.fingerprint, fingerprint),
        gt(t.registerGuards.expiresAt, new Date()),
      ),
    );
  return row?.value ?? 0;
}

/** 注册前判定：命中设备或 IP 任一上限就抛错。 */
export async function assertRegisterAllowed(params: {
  ip: string;
  userAgent: string;
  signals: DeviceSignals;
  seed: string;
  settings: RegisterGuardSettings;
}): Promise<void> {
  if (!params.settings.enabled) return;

  if (params.settings.deviceLimit > 0 && hasDeviceSignals(params.signals)) {
    const signalHits = await countWithin('signal', signalFingerprint(params.userAgent, params.signals));
    if (signalHits >= params.settings.deviceLimit) throw AppError.conflict(REGISTER_BLOCKED_MESSAGE);
    if (params.seed) {
      const deviceHits = await countWithin('device', deviceFingerprint(params.seed, params.userAgent, params.signals));
      if (deviceHits >= params.settings.deviceLimit) throw AppError.conflict(REGISTER_BLOCKED_MESSAGE);
    }
  }

  if (params.settings.ipLimit > 0) {
    const ip = ipFingerprint(params.ip);
    if (ip) {
      const ipHits = await countWithin('ip', ip);
      if (ipHits >= params.settings.ipLimit) throw AppError.conflict(REGISTER_IP_BLOCKED_MESSAGE);
    }
  }
}

/** 注册成功后落库，窗口到点自动失效。 */
export async function rememberRegistration(params: {
  userId: string;
  ip: string;
  userAgent: string;
  signals: DeviceSignals;
  seed: string;
  settings: RegisterGuardSettings;
}): Promise<void> {
  if (!params.settings.enabled) return;
  const expiresAt = new Date(Date.now() + params.settings.windowDays * 86_400_000);
  const rows: Array<{ kind: 'signal' | 'device' | 'ip'; fingerprint: string }> = [];
  if (hasDeviceSignals(params.signals)) {
    rows.push({ kind: 'signal', fingerprint: signalFingerprint(params.userAgent, params.signals) });
    if (params.seed) {
      rows.push({ kind: 'device', fingerprint: deviceFingerprint(params.seed, params.userAgent, params.signals) });
    }
  }
  const ip = ipFingerprint(params.ip);
  if (ip) rows.push({ kind: 'ip', fingerprint: ip });
  if (rows.length === 0) return;

  await db.insert(t.registerGuards).values(
    rows.map((row) => ({
      kind: row.kind,
      fingerprint: row.fingerprint,
      userId: params.userId,
      ip: params.ip.slice(0, 64),
      userAgent: params.userAgent.slice(0, 300),
      expiresAt,
    })),
  );
}
