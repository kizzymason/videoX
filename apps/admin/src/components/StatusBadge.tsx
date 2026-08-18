import { Badge, cn } from '@videox/ui';

const VIDEO_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-muted text-muted-foreground' },
  uploading: { label: '上传中', className: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  transcoding: { label: '转码中', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  partially_ready: { label: '可播(补档中)', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  ready: { label: '已就绪', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  failed: { label: '失败', className: 'bg-destructive/12 text-destructive' },
  archived: { label: '已归档', className: 'bg-muted text-muted-foreground' },
};

const WORKING = 'bg-amber-500/12 text-amber-700 dark:text-amber-300';

const JOB_STATUS: Record<string, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'bg-muted text-muted-foreground' },
  probing: { label: '探测中', className: WORKING },
  thumbnailing: { label: '出封面', className: WORKING },
  transcoding: { label: '转码中', className: WORKING },
  packaging: { label: '打包中', className: WORKING },
  completed: { label: '已完成', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  failed: { label: '失败', className: 'bg-destructive/12 text-destructive' },
  canceled: { label: '已取消', className: 'bg-muted text-muted-foreground' },
};

/** 尚未终结的任务：可取消、且应在「在途」区展示。 */
export const ACTIVE_JOB_STATUSES: readonly string[] = ['queued', 'probing', 'thumbnailing', 'transcoding', 'packaging'];

const GENERIC: Record<string, { label: string; className: string }> = {
  active: { label: '正常', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  banned: { label: '已封禁', className: 'bg-destructive/12 text-destructive' },
  pending: { label: '待激活', className: 'bg-muted text-muted-foreground' },
  visible: { label: '已显示', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  hidden: { label: '已隐藏', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  deleted: { label: '已删除', className: 'bg-destructive/12 text-destructive' },
  unused: { label: '未使用', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  used: { label: '已使用', className: 'bg-muted text-muted-foreground' },
  expired: { label: '已过期', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  disabled: { label: '已作废', className: 'bg-destructive/12 text-destructive' },
  paid: { label: '已支付', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  refunded: { label: '已退款', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  canceled: { label: '已取消', className: 'bg-muted text-muted-foreground' },
  running: { label: '进行中', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  completed: { label: '已完成', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  failed: { label: '失败', className: 'bg-destructive/12 text-destructive' },
  public: { label: '公开', className: 'bg-muted text-muted-foreground' },
  unlisted: { label: '不公开', className: 'bg-muted text-muted-foreground' },
  private: { label: '私密', className: 'bg-muted text-muted-foreground' },
};

const MAPS = { video: VIDEO_STATUS, job: JOB_STATUS, generic: GENERIC } as const;

export function StatusBadge({
  status,
  kind = 'generic',
  className,
}: {
  status: string;
  kind?: keyof typeof MAPS;
  className?: string;
}) {
  const entry = MAPS[kind][status] ?? GENERIC[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return (
    <Badge variant="outline" className={cn('border-transparent font-normal', entry.className, className)}>
      {entry.label}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (role === 'admin') return <Badge>管理员</Badge>;
  if (role === 'vip') return <Badge variant="vip">会员</Badge>;
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      普通
    </Badge>
  );
}

export function AccessBadge({ level }: { level: string }) {
  if (level === 'vip') return <Badge variant="vip">会员</Badge>;
  if (level === 'login') return <Badge variant="secondary">登录可见</Badge>;
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      免费
    </Badge>
  );
}
