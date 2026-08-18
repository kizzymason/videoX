import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { SiteSettings } from '@videox/shared';
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
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: SiteSettings) => systemApi.saveSite(body),
    onSuccess: async () => {
      toast.success('站点设置已保存');
      await queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
        description="标题、主题、注册开关、会员试看与 SEO 模板"
        actions={
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
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
            </Panel>

            <Panel title="会员与播放">
              <Field label="会员视频试看秒数" hint="非会员可看的前 N 秒；设为 0 表示完全不可看。服务端按分片序号硬校验。">
                <Input
                  type="number"
                  min={0}
                  max={3600}
                  value={draft.previewSeconds}
                  onChange={(e) => patch({ previewSeconds: Number(e.target.value) || 0 })}
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
