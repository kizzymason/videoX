/**
 * 播放页「控制台劝退」的判定策略。
 *
 * 放在 shared 而不是 ui 里，是因为这套规则必须能被单测锁住：它过去只在真机
 * 旋屏时才暴露误杀，靠人工点击几乎回归不到，只能把判定抽成纯函数。
 *
 * 两条判据的适用面完全不同，不能混着看：
 *
 * 1. **尺寸差**（outer 与 inner 的落差）—— 只对「桌面浏览器 + 非全屏」成立。
 *    devtools 以面板形式停靠时会撑大这个差，但它同时也是手机与全屏的固有噪声：
 *    - 手机：outer 含地址栏与系统栏，差值本就上百像素；旋屏过程中内外两套尺寸
 *      还会短暂错位，iOS Safari 横屏时 outerWidth 甚至常年停留在竖屏宽度，
 *      差值随便就几百像素。拿它当证据等于「转一下屏幕就判你开了控制台」。
 *    - 全屏：inner 变成屏幕尺寸，outer 仍是窗口尺寸，两者天然对不上。
 *
 * 2. **调试器耗时**（`debugger` 语句的实际停留时间）—— 只有真被挂起才会变大，
 *    与视口尺寸无关，是唯一在手机上说得通的信号，所以全端保留。
 *
 * 另外两条判据都要求「连续多次采样都命中」才生效，单次抖动一律不算。
 */

export interface ConsoleShieldEnv {
  /** `matchMedia('(pointer: coarse)')` 的结果，触屏设备为 true。 */
  coarsePointer: boolean;
  /** `navigator.maxTouchPoints`。 */
  maxTouchPoints: number;
}

export interface ConsoleShieldSample {
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  /** 当前是否处于全屏（`document.fullscreenElement` 非空）。 */
  fullscreen: boolean;
  /**
   * 本轮 `debugger` 语句实际耗时（毫秒）。
   * 挂着调试器时会被真挂起，值很大；没有调试器时接近 0。
   */
  debuggerCostMs: number;
}

export interface ConsoleShieldOptions {
  /** outer/inner 差超过多少像素才怀疑有 devtools 面板停靠。 */
  sizeGapThreshold?: number;
  /** `debugger` 语句耗时超过多少毫秒才算被挂起。 */
  debuggerCostThreshold?: number;
  /** 要连续多少次采样都命中才判定，避免单次抖动误伤。 */
  confirmations?: number;
}

export const CONSOLE_SHIELD_DEFAULTS = {
  sizeGapThreshold: 180,
  debuggerCostThreshold: 120,
  confirmations: 2,
} as const;

/** 采样间隔。 */
export const CONSOLE_SHIELD_INTERVAL_MS = 1600;

/**
 * 视口变化（旋屏、拖窗口、进出全屏）后等多久再恢复判定。
 * 变化过程中内外两套尺寸是会抖的，抖完再判才不会误伤。
 */
export const CONSOLE_SHIELD_SETTLE_MS = 700;

/** 触屏设备判定：粗指针或报告了触摸点，任一成立即认为可能跑在手机上。 */
export function isTouchDevice(env: ConsoleShieldEnv): boolean {
  return env.coarsePointer || env.maxTouchPoints > 0;
}

/** 尺寸差这条判据是否可用。全屏与触屏设备一律不可用，原因见文件头注释。 */
export function canUseSizeHeuristic(env: ConsoleShieldEnv, fullscreen: boolean): boolean {
  if (fullscreen) return false;
  return !isTouchDevice(env);
}

export interface ConsoleShieldProbe {
  /** 视口刚变化过，把上一轮攒下的计数作废，避免旧证据叠加成误判。 */
  invalidate(): void;
  /** 采一次样，返回是否应当判定为「打开了控制台」。 */
  sample(input: ConsoleShieldSample): boolean;
}

export function createConsoleShieldProbe(
  env: ConsoleShieldEnv,
  options: ConsoleShieldOptions = {},
): ConsoleShieldProbe {
  const sizeGapThreshold = options.sizeGapThreshold ?? CONSOLE_SHIELD_DEFAULTS.sizeGapThreshold;
  const debuggerCostThreshold =
    options.debuggerCostThreshold ?? CONSOLE_SHIELD_DEFAULTS.debuggerCostThreshold;
  const confirmations = options.confirmations ?? CONSOLE_SHIELD_DEFAULTS.confirmations;

  let sizeHits = 0;
  let debuggerHits = 0;

  return {
    invalidate() {
      sizeHits = 0;
      debuggerHits = 0;
    },

    sample(input) {
      if (canUseSizeHeuristic(env, input.fullscreen)) {
        const widthGap = Math.abs(input.outerWidth - input.innerWidth);
        const heightGap = Math.abs(input.outerHeight - input.innerHeight);
        sizeHits = widthGap > sizeGapThreshold || heightGap > sizeGapThreshold ? sizeHits + 1 : 0;
      } else {
        // 判据不适用时必须归零。否则旋屏前攒下的次数会一直留着，
        // 等退出全屏或换回桌面时再叠上去，等于换个姿势误杀。
        sizeHits = 0;
      }

      debuggerHits = input.debuggerCostMs > debuggerCostThreshold ? debuggerHits + 1 : 0;

      return sizeHits >= confirmations || debuggerHits >= confirmations;
    },
  };
}
