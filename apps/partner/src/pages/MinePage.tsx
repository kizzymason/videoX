import { useQuery } from '@tanstack/react-query';
import { partnerLevelLabel } from '@videox/shared';
import { Button } from '@videox/ui';
import { partnerApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export function MinePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });
  const profile = me.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">我的</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.displayName} · @{user?.username}</p>
      </header>

      <div className="stat-card space-y-3">
        <p className="text-sm text-muted-foreground">等级权限</p>
        <p className="text-xl font-semibold">{profile ? partnerLevelLabel(profile.level) : '—'}</p>
        <p className="text-xs text-muted-foreground">权限由总站下发的卡密张数与天数配额决定，并自带视频会员。</p>
      </div>

      <Quota label="卡密生成数量" used={profile?.codesIssued ?? 0} total={profile?.codeQuota ?? 0} remain={profile?.codeRemaining ?? 0} />
      <Quota label="可发放时长" used={profile?.daysIssued ?? 0} total={profile?.daysQuota ?? 0} remain={profile?.daysRemaining ?? 0} unit="天" />

      <Button variant="outline" className="w-full" onClick={() => void logout()}>
        退出登录
      </Button>
    </div>
  );
}

function Quota({
  label,
  used,
  total,
  remain,
  unit = '张',
}: {
  label: string;
  used: number;
  total: number;
  remain: number;
  unit?: string;
}) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className="stat-card space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used}/{total} {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">剩余 {remain} {unit}</p>
    </div>
  );
}
