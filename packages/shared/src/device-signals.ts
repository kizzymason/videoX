/**
 * 注册设备信号：前端稳定能读到的一小撮信息，交给服务端做指纹。
 *
 * 刻意不采 Canvas / 字体 / 音频这类高熵信号——同型号同系统的两台手机很容易撞在一起，
 * 会把正常用户挡在门外。这里只用平台、屏幕、时区、语言、核数、内存、触点数与 GPU 型号，
 * 同一台设备稳定，不同机型/系统版本能区分；再叠加服务端下发的设备 cookie 一起算哈希。
 *
 * 本包在服务端也会被 import，tsconfig 里没有 dom lib，所以这里不引用 window / document /
 * navigator 这些全局类型，一律走 globalThis 上的最小结构断言。
 *
 * 前端只负责读，哈希与判定全在服务端，改前端参数改不了结论。
 */
import { z } from 'zod';

export const deviceSignalsSchema = z
  .object({
    platform: z.string().max(64).default(''),
    screen: z.string().max(32).default(''),
    tz: z.string().max(64).default(''),
    lang: z.string().max(32).default(''),
    cores: z.number().int().min(0).max(1024).default(0),
    memory: z.number().min(0).max(1024).default(0),
    touch: z.number().int().min(0).max(64).default(0),
    gpu: z.string().max(160).default(''),
  })
  .strict();

export type DeviceSignals = z.infer<typeof deviceSignalsSchema>;

export const EMPTY_DEVICE_SIGNALS: DeviceSignals = {
  platform: '',
  screen: '',
  tz: '',
  lang: '',
  cores: 0,
  memory: 0,
  touch: 0,
  gpu: '',
};

interface MinimalGl {
  getExtension(name: string): unknown;
  getParameter(param: unknown): unknown;
}

interface MinimalCanvas {
  getContext(kind: string): unknown;
}

interface MinimalWindow {
  screen?: { width: number; height: number };
  devicePixelRatio?: number;
  document?: { createElement(tag: string): MinimalCanvas };
}

interface MinimalNavigator {
  platform?: string;
  language?: string;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  deviceMemory?: number;
  userAgentData?: { platform?: string };
}

/** 浏览器里能拿到的信号；非浏览器环境返回空值。 */
export function collectDeviceSignals(): DeviceSignals {
  const host = globalThis as unknown as { window?: MinimalWindow; navigator?: MinimalNavigator };
  const win = host.window;
  const nav = host.navigator;
  if (!win || !nav) return { ...EMPTY_DEVICE_SIGNALS };

  let gpu = '';
  try {
    const canvas = win.document?.createElement('canvas');
    const gl = canvas?.getContext('webgl') as MinimalGl | null | undefined;
    const info = gl?.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL?: unknown } | undefined;
    const renderer = gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    if (typeof renderer === 'string') gpu = renderer.slice(0, 160);
  } catch {
    gpu = '';
  }

  const width = win.screen?.width ?? 0;
  const height = win.screen?.height ?? 0;
  return {
    platform: String(nav.userAgentData?.platform || nav.platform || '').slice(0, 64),
    screen: width && height ? `${width}x${height}x${win.devicePixelRatio || 1}`.slice(0, 32) : '',
    tz: String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 64),
    lang: String(nav.language || '').slice(0, 32),
    cores: Number.isFinite(nav.hardwareConcurrency) ? Math.min(Number(nav.hardwareConcurrency), 1024) : 0,
    memory: Number.isFinite(nav.deviceMemory) ? Math.min(Number(nav.deviceMemory), 1024) : 0,
    touch: Number.isFinite(nav.maxTouchPoints) ? Math.min(Number(nav.maxTouchPoints), 64) : 0,
    gpu,
  };
}
