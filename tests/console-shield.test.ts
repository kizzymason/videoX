import { describe, expect, it } from 'vitest';
import {
  CONSOLE_SHIELD_DEFAULTS,
  CONSOLE_SHIELD_INTERVAL_MS,
  CONSOLE_SHIELD_SETTLE_MS,
  canUseSizeHeuristic,
  createConsoleShieldProbe,
  isTouchDevice,
  type ConsoleShieldEnv,
  type ConsoleShieldSample,
} from '@videox/shared';

/** 桌面：鼠标、无触摸点。 */
const DESKTOP: ConsoleShieldEnv = { coarsePointer: false, maxTouchPoints: 0 };
/** 手机：粗指针 + 有触摸点。 */
const PHONE: ConsoleShieldEnv = { coarsePointer: true, maxTouchPoints: 5 };

/** 起始样本：内外尺寸一致、非全屏、没有调试器挂着。 */
function sample(overrides: Partial<ConsoleShieldSample> = {}): ConsoleShieldSample {
  return {
    outerWidth: 1280,
    outerHeight: 800,
    innerWidth: 1280,
    innerHeight: 800,
    fullscreen: false,
    debuggerCostMs: 0,
    ...overrides,
  };
}

/** 旋屏那一瞬间的典型读数：内外两套尺寸互相错位。 */
function rotated(env: ConsoleShieldEnv) {
  return [
    sample({ outerWidth: 390, outerHeight: 844, innerWidth: 844, innerHeight: 390 }),
    sample({ outerWidth: 844, outerHeight: 390, innerWidth: 390, innerHeight: 844 }),
  ];
}

describe('控制台劝退：设备判定', () => {
  it('粗指针即认为可能跑在手机上', () => {
    expect(isTouchDevice({ coarsePointer: true, maxTouchPoints: 0 })).toBe(true);
  });

  it('报告了触摸点也算手机', () => {
    expect(isTouchDevice({ coarsePointer: false, maxTouchPoints: 1 })).toBe(true);
  });

  it('鼠标桌面不算手机', () => {
    expect(isTouchDevice(DESKTOP)).toBe(false);
  });

  it('尺寸差判据只在桌面端非全屏时可用', () => {
    expect(canUseSizeHeuristic(DESKTOP, false)).toBe(true);
    expect(canUseSizeHeuristic(DESKTOP, true)).toBe(false);
    expect(canUseSizeHeuristic(PHONE, false)).toBe(false);
    expect(canUseSizeHeuristic(PHONE, true)).toBe(false);
  });
});

describe('控制台劝退：移动端旋屏不误杀（回归用例）', () => {
  it('手机横竖屏切换的内外尺寸错位，采多少次都不判定', () => {
    const probe = createConsoleShieldProbe(PHONE);
    for (const input of rotated(PHONE)) {
      for (let i = 0; i < 20; i += 1) {
        expect(probe.sample(input)).toBe(false);
      }
    }
  });

  it('手机全屏看视频时内外尺寸必然对不上，也不判定', () => {
    const probe = createConsoleShieldProbe(PHONE);
    const fullscreen = sample({ outerWidth: 390, outerHeight: 844, innerWidth: 844, innerHeight: 390, fullscreen: true });
    for (let i = 0; i < 10; i += 1) {
      expect(probe.sample(fullscreen)).toBe(false);
    }
  });

  it('手机浏览器地址栏造成的上百像素落差不算证据', () => {
    const probe = createConsoleShieldProbe(PHONE);
    const chrome = sample({ outerWidth: 390, outerHeight: 780, innerWidth: 390, innerHeight: 520 });
    expect(probe.sample(chrome)).toBe(false);
    expect(probe.sample(chrome)).toBe(false);
  });

  it('手机上调试器真的被挂起时仍然判定，只是需要连续两次', () => {
    const probe = createConsoleShieldProbe(PHONE);
    expect(probe.sample(sample({ debuggerCostMs: 0 }))).toBe(false);
    expect(probe.sample(sample({ debuggerCostMs: 900 }))).toBe(false);
    expect(probe.sample(sample({ debuggerCostMs: 900 }))).toBe(true);
  });
});

describe('控制台劝退：桌面端仍然拦得住', () => {
  it('devtools 面板停靠造成的尺寸差，连续两次后判定', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const docked = sample({ outerWidth: 1920, innerWidth: 1400 });
    expect(probe.sample(docked)).toBe(false);
    expect(probe.sample(docked)).toBe(true);
  });

  it('底边停靠面板同样能识别', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const docked = sample({ outerHeight: 1040, innerHeight: 620 });
    probe.sample(docked);
    expect(probe.sample(docked)).toBe(true);
  });

  it('单次尺寸抖动不算数', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    expect(probe.sample(sample({ outerWidth: 1920, innerWidth: 1400 }))).toBe(false);
    expect(probe.sample(sample())).toBe(false);
    expect(probe.sample(sample())).toBe(false);
  });

  it('尺寸恢复后计数归零，需要重新连续命中', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const docked = sample({ outerWidth: 1920, innerWidth: 1400 });
    probe.sample(docked);
    probe.sample(sample());
    expect(probe.sample(docked)).toBe(false);
    expect(probe.sample(docked)).toBe(true);
  });

  it('桌面全屏（F11）的内外尺寸落差不算证据', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const fullscreen = sample({ outerWidth: 1280, outerHeight: 700, innerWidth: 1920, innerHeight: 1080, fullscreen: true });
    for (let i = 0; i < 10; i += 1) {
      expect(probe.sample(fullscreen)).toBe(false);
    }
  });

  it('进出全屏时的尺寸差不会和之前的命中叠加成误判', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const docked = sample({ outerWidth: 1920, innerWidth: 1400 });
    expect(probe.sample(docked)).toBe(false); // 攒下 1 次
    expect(probe.sample(sample({ ...docked, fullscreen: true }))).toBe(false); // 全屏，计数清零
    expect(probe.sample(docked)).toBe(false); // 只剩 1 次，不该判定
    expect(probe.sample(docked)).toBe(true);
  });

  it('调试器耗时连续两次超阈值才判定', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    expect(probe.sample(sample({ debuggerCostMs: 500 }))).toBe(false);
    expect(probe.sample(sample())).toBe(false);
    expect(probe.sample(sample({ debuggerCostMs: 500 }))).toBe(false);
    expect(probe.sample(sample({ debuggerCostMs: 500 }))).toBe(true);
  });

  it('两条判据各自计数，不互相累加', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const both = sample({ outerWidth: 1920, innerWidth: 1400, debuggerCostMs: 500 });
    // 一次采样里两条判据各命中 1 次。若把两边的命中数相加，就会在这一次
    // 采样上凑够 2 次而误判 —— 必须各算各的。
    expect(probe.sample(both)).toBe(false);
    expect(probe.sample(both)).toBe(true);
  });
});

describe('控制台劝退：阈值边界', () => {
  it('尺寸差恰好等于阈值不算命中', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const edge = sample({ outerWidth: 1280 + CONSOLE_SHIELD_DEFAULTS.sizeGapThreshold, innerWidth: 1280 });
    probe.sample(edge);
    expect(probe.sample(edge)).toBe(false);
  });

  it('尺寸差超过阈值 1 像素即命中', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const edge = sample({ outerWidth: 1281 + CONSOLE_SHIELD_DEFAULTS.sizeGapThreshold, innerWidth: 1280 });
    probe.sample(edge);
    expect(probe.sample(edge)).toBe(true);
  });

  it('调试器耗时恰好等于阈值不算命中', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const edge = sample({ debuggerCostMs: CONSOLE_SHIELD_DEFAULTS.debuggerCostThreshold });
    probe.sample(edge);
    expect(probe.sample(edge)).toBe(false);
  });

  it('阈值可覆盖', () => {
    const probe = createConsoleShieldProbe(DESKTOP, { sizeGapThreshold: 10, confirmations: 1 });
    expect(probe.sample(sample({ outerWidth: 1300, innerWidth: 1280 }))).toBe(true);
  });

  it('确认次数可覆盖', () => {
    const strict = createConsoleShieldProbe(DESKTOP, { confirmations: 3 });
    const docked = sample({ outerWidth: 1920, innerWidth: 1400 });
    expect(strict.sample(docked)).toBe(false);
    expect(strict.sample(docked)).toBe(false);
    expect(strict.sample(docked)).toBe(true);
  });
});

describe('控制台劝退：invalidate 丢弃旧证据', () => {
  it('每次视口变化都作废计数，连续抖动永远不判定', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    const docked = sample({ outerWidth: 1920, innerWidth: 1400 });
    for (let i = 0; i < 20; i += 1) {
      probe.sample(docked);
      probe.invalidate();
    }
    // 抖动停下后重新连续采样才会命中
    probe.sample(docked);
    expect(probe.sample(docked)).toBe(true);
  });

  it('同时清掉调试器那一侧的计数', () => {
    const probe = createConsoleShieldProbe(DESKTOP);
    probe.sample(sample({ debuggerCostMs: 500 }));
    probe.invalidate();
    expect(probe.sample(sample({ debuggerCostMs: 500 }))).toBe(false);
    expect(probe.sample(sample({ debuggerCostMs: 500 }))).toBe(true);
  });
});

describe('控制台劝退：常量', () => {
  it('默认阈值稳定', () => {
    expect(CONSOLE_SHIELD_DEFAULTS).toEqual({
      sizeGapThreshold: 180,
      debuggerCostThreshold: 120,
      confirmations: 2,
    });
  });

  it('采样间隔与稳定等待时长稳定', () => {
    expect(CONSOLE_SHIELD_INTERVAL_MS).toBe(1600);
    expect(CONSOLE_SHIELD_SETTLE_MS).toBe(700);
  });

  it('稳定等待时长覆盖旋屏动画的常见时长', () => {
    expect(CONSOLE_SHIELD_SETTLE_MS).toBeGreaterThanOrEqual(400);
  });
});
