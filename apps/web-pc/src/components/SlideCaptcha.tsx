import * as React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@videox/ui';

const KNOB = 40;
const PAD = 2;
const THRESHOLD = 0.92;

export function SlideCaptcha({
  onComplete,
  disabled,
  text = '右滑验证并注册',
  className,
}: {
  onComplete: () => Promise<void> | void;
  disabled?: boolean;
  text?: string;
  className?: string;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const startX = React.useRef(0);
  const startRatio = React.useRef(0);
  const ratioRef = React.useRef(0);
  const [ratio, setRatio] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const setRatioBoth = (value: number) => {
    ratioRef.current = value;
    setRatio(value);
  };

  const finish = async () => {
    if (done || busy) return;
    setRatioBoth(1);
    setBusy(true);
    try {
      await onComplete();
      setDone(true);
    } catch {
      setRatioBoth(0);
      setDone(false);
    } finally {
      setBusy(false);
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || busy || done) return;
    dragging.current = true;
    startX.current = event.clientX;
    startRatio.current = ratioRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    const track = trackRef.current;
    if (!track) return;
    const travel = Math.max(1, track.clientWidth - KNOB - PAD * 2);
    const next = Math.min(1, Math.max(0, startRatio.current + (event.clientX - startX.current) / travel));
    setRatioBoth(next);
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (ratioRef.current >= THRESHOLD) void finish();
    else setRatioBoth(0);
  };

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative h-12 select-none overflow-hidden rounded-full border border-border bg-muted',
        (disabled || busy) && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <div
        className="absolute inset-y-0 left-0 bg-foreground/10"
        style={{ width: `calc(${PAD}px + ${ratio} * (100% - ${PAD * 2}px))` }}
      />
      <p
        className={cn(
          'relative z-10 grid h-full place-items-center text-sm text-muted-foreground transition-opacity',
          (ratio > 0.18 || done) && 'opacity-0',
        )}
      >
        {text}
      </p>
      <button
        type="button"
        aria-label={text}
        disabled={disabled || busy || done}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute top-0.5 z-20 grid size-10 touch-none place-items-center rounded-full bg-primary text-primary-foreground shadow-sm"
        style={{
          left: PAD,
          transform: `translateX(calc(${ratio} * (100% - ${KNOB + PAD * 2}px)))`,
        }}
      >
        {done ? <Check className="size-4" strokeWidth={2.5} /> : <ChevronRight className="size-4" strokeWidth={2.5} />}
      </button>
    </div>
  );
}
