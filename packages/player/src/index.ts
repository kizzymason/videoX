/**
 * @videox/player —— 自研 HLS 播放器。
 *
 * 分三层：core（无 UI 的引擎）→ react（hook 适配）→ skins（PC / 移动两套独立皮肤）。
 * 皮肤之间不共享布局代码，只共享进度条与遮罩这类纯展示件。
 */

export { PlayerEngine, PLAYBACK_RATES } from './core/engine.js';
export { bindHotkeys, type HotkeyContext } from './core/hotkeys.js';
export { parseSpriteVtt, loadSpriteCues, findSpriteCue } from './core/sprites.js';
export { prefs, bandwidth, localProgress } from './core/storage.js';
export { usePlayer, type UsePlayerOptions, type UsePlayerResult } from './react/use-player.js';
export { ProgressBar, type ProgressBarProps } from './skins/shared/progress-bar.js';
export { LoadingVeil, ErrorVeil, GateVeil, type GateVeilProps } from './skins/shared/overlays.js';

export type {
  GateState,
  PlayerEngineOptions,
  PlayerError,
  PlayerErrorKind,
  PlayerSnapshot,
  PlayerSource,
  PlayerStatus,
  QualityLevel,
  RenewedTicket,
  SpriteCue,
} from './types.js';
