import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MembershipPlan } from '@videox/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Switch,
  Textarea,
  cn,
} from '@videox/ui';
import { membershipApi } from '../lib/api';
import { formatCents } from '../lib/format';
import { PageHeader } from '../components/Page';
import { useConfirm } from '../components/ConfirmDialog';

interface PlanDraft {
  id?: string;
  code: string;
  name: string;
  description: string;
  durationDays: number;
  priceYuan: string;
  originalPriceYuan: string;
  perks: string;
  badge: string;
  isRecommended: boolean;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY: PlanDraft = {
  code: '',
  name: '',
  description: '',
  durationDays: 30,
  priceYuan: '',
  originalPriceYuan: '',
  perks: '',
  badge: '',
  isRecommended: false,
  sortOrder: 0,
  isActive: true,
};

/** 后端存分，界面按元填。避免浮点误差，四舍五入到分。 */
const toCents = (yuan: string) => Math.round(Number(yuan || 0) * 100);
const toYuan = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

export function PlansPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = React.useState<PlanDraft | null>(null);

  const list = useQuery({ queryKey: ['admin-plans'], queryFn: membershipApi.plans });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-plans'] });

  const save = useMutation({
    mutationFn: (input: PlanDraft) => {
      const body = {
        code: input.code.trim(),
        name: input.name.trim(),
        description: input.description.trim() || null,
        durationDays: input.durationDays,
        priceCents: toCents(input.priceYuan),
        originalPriceCents: input.originalPriceYuan ? toCents(input.originalPriceYuan) : null,
        perks: input.perks
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        badge: input.badge.trim() || null,
        isRecommended: input.isRecommended,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      };
      return input.id ? membershipApi.updatePlan(input.id, body) : membershipApi.createPlan(body);
    },
    onSuccess: async () => {
      toast.success('已保存');
      setDraft(null);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => membershipApi.deletePlan(id),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => membershipApi.updatePlan(id, { isActive }),
    onSuccess: () => void invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const plans = [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const edit = (plan: MembershipPlan) =>
    setDraft({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description ?? '',
      durationDays: plan.durationDays,
      priceYuan: toYuan(plan.priceCents),
      originalPriceYuan: toYuan(plan.originalPriceCents),
      perks: plan.perks.join('\n'),
      badge: plan.badge ?? '',
      isRecommended: plan.isRecommended,
      sortOrder: plan.sortOrder,
      isActive: plan.isActive,
    });

  return (
    <div>
      <PageHeader
        title="套餐管理"
        description="前台会员页展示的套餐；卡密面额也绑定在套餐上"
        actions={
          <Button size="sm" onClick={() => setDraft({ ...EMPTY, sortOrder: plans.length })}>
            <Plus />
            新建套餐
          </Button>
        }
      />

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
          <Crown className="size-7" strokeWidth={1.5} />
          <p className="text-sm">还没有套餐，先建一个再去生成卡密</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                'relative flex flex-col rounded-xl border bg-card p-4',
                plan.isRecommended ? 'border-foreground' : 'border-border',
                !plan.isActive && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{plan.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{plan.code}</p>
                </div>
                {plan.badge ? <Badge variant="vip">{plan.badge}</Badge> : null}
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatCents(plan.priceCents)}</span>
                {plan.originalPriceCents ? (
                  <span className="text-xs text-muted-foreground line-through tabular-nums">
                    {formatCents(plan.originalPriceCents)}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{plan.durationDays} 天</p>

              {plan.perks.length > 0 ? (
                <ul className="mt-3 flex-1 space-y-1">
                  {plan.perks.slice(0, 4).map((perk) => (
                    <li key={perk} className="truncate text-xs text-muted-foreground">
                      · {perk}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex-1" />
              )}

              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Switch checked={plan.isActive} onCheckedChange={(checked) => toggle.mutate({ id: plan.id, isActive: checked })} />
                <span className="flex-1 text-[11px] text-muted-foreground">{plan.isActive ? '售卖中' : '已下架'}</span>
                <Button variant="ghost" size="icon" title="编辑" onClick={() => edit(plan)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="删除"
                  onClick={async () => {
                    const ok = await confirm({
                      title: '删除该套餐？',
                      description: `“${plan.name}” 关联的卡密将无法再兑换。`,
                      confirmText: '删除',
                      destructive: true,
                    });
                    if (ok) remove.mutate(plan.id);
                  }}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-120">
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑套餐' : '新建套餐'}</DialogTitle>
            <DialogDescription>价格按元填写，系统内部以分存储。</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="scrollbar-thin max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="套餐名">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="月度会员" />
                </Field>
                <Field label="套餐代码" hint="唯一标识，卡密前缀可参考">
                  <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="monthly" />
                </Field>
                <Field label="时长（天）">
                  <Input
                    type="number"
                    min={1}
                    value={draft.durationDays}
                    onChange={(e) => setDraft({ ...draft, durationDays: Number(e.target.value) || 1 })}
                  />
                </Field>
                <Field label="排序值">
                  <Input
                    type="number"
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="售价（元）">
                  <Input value={draft.priceYuan} onChange={(e) => setDraft({ ...draft, priceYuan: e.target.value })} placeholder="19.90" />
                </Field>
                <Field label="划线价（元）" hint="留空则不展示">
                  <Input
                    value={draft.originalPriceYuan}
                    onChange={(e) => setDraft({ ...draft, originalPriceYuan: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="简介">
                <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field label="权益点" hint="每行一条，展示在套餐卡片上">
                <Textarea
                  rows={4}
                  value={draft.perks}
                  onChange={(e) => setDraft({ ...draft, perks: e.target.value })}
                  placeholder={'全站会员视频\n1080P 高码率\n无广告'}
                />
              </Field>
              <Field label="角标文案" hint="例如「最超值」">
                <Input value={draft.badge} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={draft.isRecommended}
                    onCheckedChange={(checked) => setDraft({ ...draft, isRecommended: checked })}
                  />
                  推荐套餐
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={draft.isActive} onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })} />
                  上架售卖
                </label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              disabled={save.isPending || !draft?.name.trim() || !draft?.code.trim()}
              onClick={() => draft && save.mutate(draft)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}
    </div>
  );
}
