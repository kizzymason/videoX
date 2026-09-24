import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  ADMIN_PATH_MAX,
  isValidAdminPath,
  normalizeAdminPath,
  SIGNUP_GIFT_MAX_DAYS,
  type SiteSettings,
} from '@videox/shared';
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@videox/ui';
import { systemApi } from '../lib/api';
import { PageHeader } from '../components/Page';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<SiteSettings | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['site-settings'], queryFn: systemApi.site });
  React.useEffect(() => {
    if (data)
      setDraft({
        ...data,
        previewSeconds: 0,
        shortsFreeCount: data.shortsFreeCount ?? 3,
        signupGiftDays: data.signupGiftDays ?? 0,
        defaultBrowseMode: data.defaultBrowseMode ?? 'paged',
        showViewCount: data.showViewCount ?? false,
        adminPath: data.adminPath ?? '',
      });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: SiteSettings) => systemApi.saveSite(body),
    onSuccess: async (saved) => {
      // 入口一改，当前地址立刻失效，必须带着用户搬到新地址，否则下一次刷新就进不来了。
      if (data?.adminPath && saved.adminPath && saved.adminPath !== data.adminPath) {
        const rest = window.location.pathname.split('/').slice(2).filter(Boolean).join('/');
        const next = `/${saved.adminPath}${rest ? `/${rest}` : ''}`;
        toast.success(`后台入口已改为 ${next}，正在跳转…`);
        window.setTimeout(() => window.location.replace(next), 1500);
        return;
      }
      toast.success('站点设置已保存');
      await queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adminPathError =
    draft && !isValidAdminPath(draft.adminPath ?? '')
      ? '需 6-32 位小写字母或数字、字母开头且至少含一个数字，且不能用 admin/api/assets 等保留词'
      : undefined;
  const dirty = draft && data ? JSON.stringify(draft) !== JSON.stringify(data) : false;
  const patch = (part: Partial<SiteSettings>) => setDraft((prev) => (prev ? { ...prev, ...part } : prev));
  const patchSeo = (part: Partial<SiteSettings['seo']>) =>
    setDraft((prev) => (prev ? { ...prev, seo: { ...prev.seo, ...part } } : prev));

  if (isLoading || !draft) {
    return (
      <div>
        <PageHeader title="站点设置" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="站点设置"
        description="标题、主题、注册开关与注册赠会员、Shorts 试看与 SEO 模板"
        actions={
          <Button
            size="sm"
            disabled={!dirty || save.isPending || Boolean(adminPathError)}
            onClick={() => save.mutate(draft)}
          >
            <Save />
            {save.isPending ? '保存中…' : '保存设置'}
          </Button>
        }
      />

      <Tabs defaultValue="basic">
        <TabsList className="mb-4">
          <TabsTrigger value="basic">基础信息</TabsTrigger>
          <TabsTrigger value="policy">功能策略</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="站点信息">
              <Field label="站点名称">
                <Input value={draft.siteName} onChange={(e) => patch({ siteName: e.target.value })} />
              </Field>
              <Field label="副标题" hint="展示在首页与登录页">
                <Input value={draft.siteTagline} onChange={(e) => patch({ siteTagline: e.target.value })} />
              </Field>
              <Field label="站点描述" hint="用作首页 meta description">
                <Textarea rows={3} value={draft.siteDescription} onChange={(e) => patch({ siteDescription: e.target.value })} />
              </Field>
              <Field label="关键词" hint="英文逗号分隔">
                <Input value={draft.siteKeywords} onChange={(e) => patch({ siteKeywords: e.target.value })} />
              </Field>
            </Panel>

            <Panel title="品牌与页脚">
              <Field label="Logo URL">
                <Input value={draft.logoUrl ?? ''} onChange={(e) => patch({ logoUrl: e.target.value || null })} />
              </Field>
              <Field label="Favicon URL">
                <Input value={draft.faviconUrl ?? ''} onChange={(e) => patch({ faviconUrl: e.target.value || null })} />
              </Field>
              <Field label="默认主题" hint="用户首次访问时的主题，之后跟随其本地选择">
                <Select value={draft.defaultTheme} onValueChange={(value) => patch({ defaultTheme: value as SiteSettings['defaultTheme'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">浅色</SelectItem>
                    <SelectItem value="dark">深色</SelectItem>
                    <SelectItem value="system">跟随系统</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ICP 备案号">
                <Input value={draft.icpBeian ?? ''} onChange={(e) => patch({ icpBeian: e.target.value || null })} />
              </Field>
              <Field label="页脚文案">
                <Input value={draft.footerText ?? ''} onChange={(e) => patch({ footerText: e.target.value || null })} />
              </Field>
              <Field label="联系邮箱">
                <Input value={draft.contactEmail ?? ''} onChange={(e) => patch({ contactEmail: e.target.value || null })} />
              </Field>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="policy">
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="用户与互动">
              <Toggle
                label="开放注册"
                hint="关闭后前台隐藏注册入口，仅管理员可建号"
                checked={draft.allowRegistration}
                onChange={(checked) => patch({ allowRegistration: checked })}
              />
              <Toggle
                label="评论先审后发"
                hint="开启后新评论默认隐藏，需在评论审核页放行"
                checked={draft.commentsRequireApproval}
                onChange={(checked) => patch({ commentsRequireApproval: checked })}
              />
              <Toggle
                label="展示播放量"
                hint="关闭后前台卡片、播放页与 Shorts 都不显示播放次数，统计照常累计。热链片源的播放数据不完整，默认关闭。"
                checked={draft.showViewCount}
                onChange={(checked) => patch({ showViewCount: checked })}
              />
              <Field label="默认浏览模式" hint="访客首次进入视频列表时的模式，用户可在顶栏自行切换">
                <Select
                  value={draft.defaultBrowseMode}
                  onValueChange={(value) =>
                    patch({ defaultBrowseMode: value as SiteSettings['defaultBrowseMode'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paged">分页（每页 20 条）</SelectItem>
                    <SelectItem value="infinite">无限流</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Panel>

            <Panel title="会员与播放">
              <Field
                label="新用户注册赠送会员"
                hint="填 0 表示不赠送。填写后每个新注册用户立刻成为会员，到期时间自动按天数算好，到期即失效，不需要人工干预。"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={SIGNUP_GIFT_MAX_DAYS}
                    value={draft.signupGiftDays}
                    onChange={(e) => patch({ signupGiftDays: clampGiftDays(e.target.value) })}
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">天</span>
                </div>
              </Field>
              <Field
                label="Shorts 免费试看条数"
                hint="游客与非会员可完整观看的不同 Shorts 条数。超出后需订阅。同一条再看不占名额。"
              >
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={draft.shortsFreeCount}
                  onChange={(e) => patch({ shortsFreeCount: Number(e.target.value) || 0, previewSeconds: 0 })}
                />
              </Field>
              <Field label="单账号并发观看数" hint="超过后旧的播放会话会被拒绝，用于防止账号共享">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.maxConcurrentStreams}
                  onChange={(e) => patch({ maxConcurrentStreams: Number(e.target.value) || 1 })}
                />
              </Field>
            </Panel>

            <Panel
              title="后台入口"
              action={
                <Button variant="ghost" size="sm" onClick={() => patch({ adminPath: randomAdminPath() })}>
                  <RefreshCw />
                  随机生成
                </Button>
              }
            >
              <Field
                label="入口路径"
                hint="6-32 位小写字母或数字，字母开头且至少含一个数字。保存后立即生效，不需要重启。"
                error={adminPathError}
              >
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs text-muted-foreground">{window.location.origin}/</span>
                  <Input
                    value={draft.adminPath ?? ''}
                    maxLength={ADMIN_PATH_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    onChange={(e) => patch({ adminPath: normalizeAdminPath(e.target.value) })}
                  />
                </div>
              </Field>
              <p className="text-xs text-muted-foreground">
                当前入口：
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {window.location.origin}/{data?.adminPath ?? draft.adminPath}
                </code>
                。保存新路径后浏览器会自动跳到新地址，旧地址会立刻变成前台页面。请先自行记录，
                这个地址只在本页显示，公开接口不会下发。
              </p>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="seo">
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="标题模板">
              <Field label="播放页标题" hint="可用变量：{title}、{siteName}、{category}、{author}">
                <Input
                  value={draft.seo.videoTitleTemplate}
                  onChange={(e) => patchSeo({ videoTitleTemplate: e.target.value })}
                />
              </Field>
              <Field label="分类页标题" hint="可用变量：{category}、{siteName}">
                <Input
                  value={draft.seo.categoryTitleTemplate}
                  onChange={(e) => patchSeo({ categoryTitleTemplate: e.target.value })}
                />
              </Field>
            </Panel>

            <Panel
              title="Sitemap 与 robots"
              action={
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" asChild>
                    <a href="/sitemap.xml" target="_blank" rel="noreferrer">
                      sitemap
                      <ExternalLink />
                    </a>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href="/robots.txt" target="_blank" rel="noreferrer">
                      robots
                      <ExternalLink />
                    </a>
                  </Button>
                </div>
              }
            >
              <Toggle
                label="启用 sitemap"
                hint="自动生成分页 sitemap 与索引文件，仅收录公开且已就绪的视频"
                checked={draft.seo.sitemapEnabled}
                onChange={(checked) => patchSeo({ sitemapEnabled: checked })}
              />
              <Field label="每页 URL 数" hint="搜索引擎建议单文件不超过 50000 条">
                <Input
                  type="number"
                  min={100}
                  max={50000}
                  value={draft.seo.sitemapPageSize}
                  onChange={(e) => patchSeo({ sitemapPageSize: Number(e.target.value) || 5000 })}
                />
              </Field>
              <Field label="robots.txt 追加内容" hint="会拼接在自动生成的规则之后">
                <Textarea
                  rows={5}
                  className="font-mono text-xs"
                  value={draft.seo.robotsExtra}
                  onChange={(e) => patchSeo({ robotsExtra: e.target.value })}
                  placeholder={'Disallow: /search\nCrawl-delay: 1'}
                />
              </Field>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * 注册赠送天数的输入处理。输入框允许中途为空（清空再重打），空值一律当 0；
 * 超出上限直接夹住，避免手滑多打一个 0 把到期时间算到几十年后。
 */
function clampGiftDays(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, SIGNUP_GIFT_MAX_DAYS);
}

/** 字母开头 + 8 位字母数字，且保证至少有一个数字（nginx 的入口正则要求带数字）。 */
function randomAdminPath(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const alphabet = `${letters}23456789`;
  const bytes = new Uint32Array(9);
  crypto.getRandomValues(bytes);
  const head = letters[bytes[0]! % letters.length]!;
  const body = Array.from(bytes.slice(1), (n) => alphabet[n % alphabet.length]!).join('');
  const withDigit = /[0-9]/.test(body) ? body : `${body.slice(0, -1)}${(bytes[0]! % 8) + 2}`;
  return `${head}${withDigit}`;
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="h-fit rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  );
}
