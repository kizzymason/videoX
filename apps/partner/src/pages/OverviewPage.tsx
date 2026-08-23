import { useQuery } from '@tanstack/react-query';
import { partnerApi } from '../lib/api';
import { formatYuan } from '../lib/format';

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['partner-overview'], queryFn: partnerApi.overview });
  const data = overview.data;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-medium tracking-widest text-primary uppercase">合伙人控制台</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">总览</h1>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="激活客户" value={data ? String(data.customerCount) : '—'} hint="使用订阅码开通" />
        <Stat label="收入" value={data ? formatYuan(data.revenueCents) : '—'} hint="已使用卡密售价" />
        <Stat label="剩余张数" value={data ? String(data.codeRemaining) : '—'} hint={`已用 ${data?.codesIssued ?? 0}/${data?.codeQuota ?? 0}`} />
        <Stat label="剩余天数" value={data ? String(data.daysRemaining) : '—'} hint={`已用 ${data?.daysIssued ?? 0}/${data?.daysQuota ?? 0}`} />
      </div>

      <div className="stat-card space-y-3">
        <p className="text-sm font-medium">运营快照</p>
        <Row label="已使用订阅码" value={data?.usedCodeCount ?? 0} />
        <Row label="未使用订阅码" value={data?.unusedCodeCount ?? 0} />
        <Row label="7 日内到期客户" value={data?.expiringSoonCount ?? 0} warn={Boolean(data && data.expiringSoonCount > 0)} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={warn ? 'font-medium text-amber-300 tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}
