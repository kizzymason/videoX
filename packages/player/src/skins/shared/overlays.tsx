import * as React from 'react';
import { AlertTriangle, Crown, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import type { PlayerError } from '../../types.js';

export function LoadingVeil({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-white" />
    </div>
  );
}

export function ErrorVeil({ error, onRetry }: { error: PlayerError | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/80 px-6 text-center backdrop-blur-sm">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <AlertTriangle className="size-8 text-white/70" />
        <p className="text-sm text-white">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          <RotateCcw className="size-4" />
          重试
        </button>
      </div>
    </div>
  );
}

export interface GateVeilProps {
  show: boolean;
  previewSeconds: number | null;
  onUnlock: () => void;
  /** 未登录时文案与跳转都不一样 */
  loggedIn?: boolean;
  onLogin?: () => void;
  className?: string;
}

/** 试看结束遮罩。core 只负责在边界处停住，展示与转化路径交给这一层。 */
export function GateVeil({ show, previewSeconds, onUnlock, loggedIn = true, onLogin, className }: GateVeilProps) {
  if (!show) return null;
  return (
    <div
      className={cn(
        'absolute inset-0 z-20 grid place-items-center bg-black/85 px-6 text-center backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full bg-[oklch(0.74_0.14_78)]/15">
          <Crown className="size-6 text-[oklch(0.8_0.14_78)]" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-white">
            {previewSeconds ? `试看 ${previewSeconds} 秒已结束` : '该内容需要会员'}
          </p>
          <p className="text-sm text-white/60">开通会员即可观看完整视频，并解锁全站会员内容</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onUnlock}
            className="rounded-lg bg-[oklch(0.79_0.14_78)] px-5 py-2 text-sm font-semibold text-[oklch(0.22_0.06_78)] transition-opacity hover:opacity-90"
          >
            开通会员
          </button>
          {!loggedIn && onLogin ? (
            <button
              type="button"
              onClick={onLogin}
              className="rounded-lg border border-white/25 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              已有账号，登录
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
