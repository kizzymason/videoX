import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  CalendarClock,
  Crown,
  Info,
  KeyRound,
  LogOut,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { partnerLevelLabel } from '@videox/shared';
import { Button, Skeleton } from '@videox/ui';
import { partnerApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { formatFullDate, formatNumber, formatYuan } from '../lib/format';
import { ChartCard, QuotaGauge, TrendAreaChart } from '../components/charts';
import { InitialAvatar, PageHeader } from '../components/primitives';

export function MinePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });
  const overview = useQuery({ queryKey: ['partner-overview'], queryFn: partnerApi.overview });
  const insights = useQuery({ queryKey: ['partner-insights', 30], queryFn: () => partnerApi.insights(30) });

  const profile = me.data;
  const stats = overview.data;

  return (
    <div className="space-y-4">
      <PageHeader title="我的" description="等级权限、配额与账号" />

      <section className="pt-card p-4">
        <div className="flex items-center gap-3">
          <InitialAvatar name={user?.displayName ?? '合'} src={user?.avatarUrl} className="size-14" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold tracking-tight">{user?.displayName ?? '—'}</p>
            <p className="truncate text-xs text-muted-foreground">@{user?.username ?? '—'}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                <BadgeCheck className="size-3" />
                {profile ? partnerLevelLabel(profile.level) : '合伙人'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-vip/20 px-2 py-0.5 text-[11px] font-medium text-vip-foreground">
                <Crown className="size-3" />
                自带视频会员
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
          成为合伙人：{profile ? formatFullDate(profile.appointedAt) : '—'}
          {profile?.note ? ` · ${profile.note}` : ''}
        </p>
      </section>

      <section className="pt-card p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">配额使用</h2>
          <span className="text-[11px] text-muted-foreground">由总站下发</span>
        </div>
        {me.isLoading ? (
          <Skeleton className="h-36 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-2 py-2">
            <QuotaGauge
              used={profile?.codesIssued ?? 0}
              total={profile?.codeQuota ?? 0}
              label="卡密"
              caption={`剩 ${formatNumber(profile?.codeRemaining ?? 0)} / ${formatNumber(profile?.codeQuota ?? 0)} 张`}
            />
            <QuotaGauge
              used={profile?.daysIssued ?? 0}
              total={profile?.daysQuota ?? 0}
              label="天数"
              caption={`剩 ${formatNumber(profile?.daysRemaining ?? 0)} / ${formatNumber(profile?.daysQuota ?? 0)} 天`}
            />
          </div>
        )}
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          生成卡密会同时扣除张数与天数（张数 × 每张时长），删除未使用的卡密会把额度退回。
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <FactCard icon={Wallet} label="累计收入" value={stats ? formatYuan(stats.revenueCents) : '—'} />
        <FactCard icon={TrendingUp} label="激活客户" value={stats ? `${formatNumber(stats.customerCount)} 位` : '—'} />
        <FactCard icon={KeyRound} label="已发卡密" value={stats ? `${formatNumber(stats.usedCodeCount + stats.unusedCodeCount)} 张` : '—'} />
        <FactCard icon={CalendarClock} label="已发天数" value={profile ? `${formatNumber(profile.daysIssued)} 天` : '—'} />
      </div>

      <ChartCard title="近 30 天出码" description="每天生成的订阅码数量">
        {insights.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <TrendAreaChart data={insights.data?.trend ?? []} series={[{ key: 'codesCreated', label: '生成' }]} height={160} />
        )}
      </ChartCard>

      <section className="pt-card p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Info className="size-3.5" />
          权限说明
        </h2>
        <ul className="space-y-2 text-[12px] leading-5 text-muted-foreground">
          <li>· 售价由你自己设定，收入统计只按你填写的售价计算，与主站定价无关。</li>
          <li>· 客户使用你的订阅码开通后自动成为你的下级客户，可在「客户」页续期。</li>
          <li>· 续期消耗的是可发放天数额度，用完需要联系总站管理员补充。</li>
          <li>· 只有未使用的卡密可以停用或删除，已核销的记录会一直保留。</li>
        </ul>
      </section>

      <Button variant="outline" className="w-full" onClick={() => void logout()}>
        <LogOut />
        退出登录
      </Button>
    </div>
  );
}

function FactCard({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string }) {
  return (
    <div className="pt-card p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className="mt-1.5 text-[18px] font-semibold leading-tight tabular-nums">{value}</p>
    </div>
  );
}
