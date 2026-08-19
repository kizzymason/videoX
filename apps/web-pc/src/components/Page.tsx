import type * as React from 'react';
import { cn } from '@videox/ui';

/** 页面容器。统一最大宽度与横向留白，保证各页面的视觉节奏一致。 */
export function PageContainer({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-[1600px] space-y-10 px-6 py-6', className)}>{children}</div>;
}

export function PageHeader({
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  // 页面所在位置已经由侧栏与 URL 表达，不再重复显示标题/副标题。
  return action ? <div className="flex justify-end">{action}</div> : null;
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-0.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? (
        <div className="text-sm text-muted-foreground transition-colors hover:text-foreground">{action}</div>
      ) : null}
    </div>
  );
}
