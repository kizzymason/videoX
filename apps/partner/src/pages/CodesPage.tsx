import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Textarea, useCopy } from '@videox/ui';
import { downloadPartnerCodesCsv, partnerApi } from '../lib/api';
import { formatYuan } from '../lib/format';

const STATUS: Record<string, string> = {
  unused: '未使用',
  used: '已使用',
  disabled: '已停用',
  expired: '已过期',
};

export function CodesPage() {
  const queryClient = useQueryClient();
  const { copy, copied } = useCopy();
  const [status, setStatus] = React.useState('all');
  const [creating, setCreating] = React.useState(false);
  const [batch, setBatch] = React.useState<string[] | null>(null);
  const [days, setDays] = React.useState('30');
  const [count, setCount] = React.useState('1');
  const [price, setPrice] = React.useState('19');
  const [note, setNote] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const list = useQuery({
    queryKey: ['partner-codes', status],
    queryFn: () => partnerApi.codes({ page: 1, pageSize: 100, status: status === 'all' ? undefined : status }),
    placeholderData: keepPreviousData,
  });
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partner-codes'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-me'] }),
    ]);
  };

  const generate = useMutation({
    mutationFn: () =>
      partnerApi.generate({
        days: Number(days),
        count: Number(count),
        salePriceYuan: Number(price),
        note: note.trim() || undefined,
      }),
    onSuccess: async (res) => {
      toast.success(`已生成 ${res.codes.length} 张`);
      setCreating(false);
      setBatch(res.codes);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disable = useMutation({
    mutationFn: (id: string) => partnerApi.disable(id),
    onSuccess: async () => {
      toast.success('已停用');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => partnerApi.bulkDelete(ids),
    onSuccess: async (res) => {
      toast.success(`已删除 ${res.deleted} 张未使用订阅码`);
      setSelected(new Set());
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">订阅</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            还可生成 {me.data?.codeRemaining ?? 0} 张 / {me.data?.daysRemaining ?? 0} 天
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          生成
        </Button>
      </header>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await downloadPartnerCodesCsv(status === 'all' ? {} : { status });
              toast.success('已开始下载');
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Download />
          导出
        </Button>
        {selected.size > 0 ? (
          <Button size="sm" variant="destructive" onClick={() => remove.mutate([...selected])}>
            <Trash2 />
            删除未使用
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2 overflow-auto">
        {(['all', 'unused', 'used', 'disabled'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`rounded-full px-3 py-1 text-xs ${status === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
          >
            {value === 'all' ? '全部' : STATUS[value]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {(list.data?.items ?? []).map((row) => (
          <div key={row.id} className="stat-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="code-mono text-left"
                onClick={() => {
                  void copy(row.code);
                  toast.success('已复制');
                }}
              >
                {row.code}
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground">{STATUS[row.status] ?? row.status}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {row.grantDays ?? '—'} 天 · {row.salePriceCents != null ? formatYuan(row.salePriceCents) : '未定价'}
              {row.usedByUsername ? ` · @${row.usedByUsername}` : ''}
            </p>
            <div className="flex gap-2">
              {row.status === 'unused' ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => disable.mutate(row.id)}>
                    停用
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = new Set(selected);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      setSelected(next);
                    }}
                  >
                    {selected.has(row.id) ? '取消选择' : '选择删除'}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ))}
        {(list.data?.items ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">还没有订阅码</p>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>生成订阅码</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="每张天数">
              <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="张数">
              <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field label="售价（元）">
              <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          </div>
          <Field label="备注">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batch !== null} onOpenChange={(v) => !v && setBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>已生成 {batch?.length} 张</DialogTitle>
          </DialogHeader>
          <Textarea readOnly rows={8} value={batch?.join('\n') ?? ''} className="code-mono" />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void copy(batch?.join('\n') ?? '');
                toast.success('已复制');
              }}
            >
              {copied ? <Check /> : <Copy />}
              复制全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
