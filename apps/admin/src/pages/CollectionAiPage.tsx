// ========================================================================
// 采集系统 - AI 维护页
// 左侧会话列表 + 右侧聊天卡片；AI 接口配置与能力清单放在弹窗里，
// 保证主视图始终是对话。写类工具会以确认卡片的形式停在对话流中等管理员放行。
// ========================================================================

import * as React from 'react';
import {
  Bot,
  Check,
  Loader2,
  Plug,
  Plus,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Textarea,
  cn,
} from '@videox/ui';
import { PageHeader } from '@/components/Page';
import {
  collectionAiApi,
  type CollectionAiConversation,
  type CollectionAiMessage,
  type CollectionAiProfile,
  type CollectionAiToolInfo,
} from '@/lib/api';

const MASKED_KEY = '••••••••';

const DEFAULT_PROFILE_DRAFT = {
  id: '',
  name: '',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: '',
  systemPrompt: '',
  temperature: 0.2,
  maxSteps: 8,
  autoApprove: false,
  isActive: true,
};

type ProfileDraft = typeof DEFAULT_PROFILE_DRAFT;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CollectionAiPage() {
  const [conversations, setConversations] = React.useState<CollectionAiConversation[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<CollectionAiMessage[]>([]);
  const [turnStatus, setTurnStatus] = React.useState<'idle' | 'awaiting_confirm'>('idle');
  const [autoApprove, setAutoApprove] = React.useState(false);

  const [profiles, setProfiles] = React.useState<CollectionAiProfile[]>([]);
  const [tools, setTools] = React.useState<CollectionAiToolInfo[]>([]);

  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [profileOpen, setProfileOpen] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(false);

  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const hasProfile = profiles.some((p) => p.isActive && p.apiKey);

  // ----------------------------------------------------------------------
  // 数据加载
  // ----------------------------------------------------------------------

  const loadConversations = React.useCallback(async () => {
    const list = await collectionAiApi.conversations();
    setConversations(list);
    return list;
  }, []);

  const loadThread = React.useCallback(async (id: string) => {
    setLoadingThread(true);
    try {
      const turn = await collectionAiApi.messages(id);
      setMessages(turn.messages);
      setTurnStatus(turn.status);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingThread(false);
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        const [list, profileList, toolList] = await Promise.all([
          collectionAiApi.conversations(),
          collectionAiApi.profiles(),
          collectionAiApi.tools(),
        ]);
        setConversations(list);
        setProfiles(profileList);
        setTools(toolList);
        if (list[0]) setActiveId(list[0].id);
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, []);

  React.useEffect(() => {
    if (activeId) void loadThread(activeId);
    else setMessages([]);
  }, [activeId, loadThread]);

  React.useEffect(() => {
    setAutoApprove(active?.autoApprove ?? false);
  }, [active?.id, active?.autoApprove]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending]);

  // ----------------------------------------------------------------------
  // 会话操作
  // ----------------------------------------------------------------------

  async function handleNewConversation() {
    setError(null);
    try {
      const created = await collectionAiApi.createConversation({ autoApprove });
      await loadConversations();
      setActiveId(created.id);
      setMessages([]);
      setTurnStatus('idle');
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function handleDeleteConversation(id: string) {
    setError(null);
    try {
      await collectionAiApi.deleteConversation(id);
      const list = await loadConversations();
      if (activeId === id) setActiveId(list[0]?.id ?? null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function handleToggleAutoApprove(next: boolean) {
    setAutoApprove(next);
    if (!activeId) return;
    try {
      await collectionAiApi.updateConversation(activeId, { autoApprove: next });
      await loadConversations();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content || !activeId || sending) return;

    setError(null);
    setSending(true);
    setDraft('');
    // 乐观插入自己的消息，等接口回来再用服务端的完整历史覆盖
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        conversationId: activeId,
        role: 'user',
        content,
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const turn = await collectionAiApi.send(activeId, content);
      setMessages(turn.messages);
      setTurnStatus(turn.status);
      await loadConversations();
    } catch (e) {
      setError(errorText(e));
      setDraft(content);
      await loadThread(activeId);
    } finally {
      setSending(false);
    }
  }

  async function handleConfirm(approve: boolean) {
    if (!activeId || sending) return;
    setError(null);
    setSending(true);
    try {
      const turn = await collectionAiApi.confirm(activeId, approve);
      setMessages(turn.messages);
      setTurnStatus(turn.status);
      await loadConversations();
    } catch (e) {
      setError(errorText(e));
      await loadThread(activeId);
    } finally {
      setSending(false);
    }
  }

  // ----------------------------------------------------------------------
  // 渲染
  // ----------------------------------------------------------------------

  const toolLabels = React.useMemo(
    () => new Map(tools.map((tool) => [tool.name, tool.label])),
    [tools],
  );

  // tool 消息不单独成气泡，挂到发起它的 assistant 卡片下面
  const toolResults = React.useMemo(() => {
    const map = new Map<string, CollectionAiMessage>();
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.toolCallId) map.set(msg.toolCallId, msg);
    }
    return map;
  }, [messages]);

  const visible = messages.filter((msg) => msg.role !== 'tool');

  return (
    <div>
      <PageHeader
        title="AI 维护"
        description="用自然语言维护采集系统：更新号池 token、新建与调整采集任务、入库发布、排查队列积压"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setToolsOpen(true)}>
              <Wrench className="mr-2 size-4" />
              能力清单
            </Button>
            <Button variant="outline" size="sm" onClick={() => setProfileOpen(true)}>
              <Settings2 className="mr-2 size-4" />
              AI 接口
            </Button>
            <Button size="sm" onClick={() => void handleNewConversation()}>
              <Plus className="mr-2 size-4" />
              新建会话
            </Button>
          </>
        }
      />

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {!hasProfile ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>还没有启用的 AI 接口，助手无法工作。请先添加接口地址、模型与 API Key。</span>
          <Button variant="outline" size="sm" onClick={() => setProfileOpen(true)}>
            去配置
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={setActiveId}
          onDelete={(id) => void handleDeleteConversation(id)}
        />

        <Card className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col gap-0 py-0">
          <CardHeader className="shrink-0 border-b py-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Bot className="size-4" />
                {active?.title ?? '采集运维助手'}
              </span>
              <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                <Switch
                  id="auto-approve"
                  checked={autoApprove}
                  disabled={!activeId}
                  onCheckedChange={(v) => void handleToggleAutoApprove(v)}
                />
                <Label htmlFor="auto-approve" className="cursor-pointer text-xs font-normal">
                  自动执行写操作
                </Label>
              </span>
            </CardTitle>
          </CardHeader>

          <CardContent className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {loadingThread ? (
              <div className="grid h-full place-items-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : !activeId ? (
              <EmptyHint onCreate={() => void handleNewConversation()} />
            ) : visible.length === 0 ? (
              <StarterHints onPick={setDraft} />
            ) : (
              visible.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  toolResults={toolResults}
                  toolLabels={toolLabels}
                  busy={sending}
                  onConfirm={(approve) => void handleConfirm(approve)}
                />
              ))
            )}

            {sending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                助手正在处理，涉及工具调用时可能要等十几秒…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </CardContent>

          <div className="shrink-0 border-t p-3">
            {turnStatus === 'awaiting_confirm' ? (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <ShieldAlert className="size-3.5" />
                有待确认的写操作，请先在上方确认或拒绝
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  activeId
                    ? '描述你要做的事，例如：把号池里 uid 为 88231 的 token 换成 xxx，然后跑一次健康检查'
                    : '请先新建一个会话'
                }
                rows={2}
                disabled={!activeId || sending || turnStatus === 'awaiting_confirm'}
                className="max-h-40 min-h-[56px] resize-none"
              />
              <Button
                onClick={() => void handleSend()}
                disabled={!activeId || sending || !draft.trim() || turnStatus === 'awaiting_confirm'}
                className="h-[56px]"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Enter 发送，Shift + Enter 换行。关闭「自动执行写操作」时，改数据的动作都需要你点确认。
            </p>
          </div>
        </Card>
      </div>

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        profiles={profiles}
        onChanged={async () => setProfiles(await collectionAiApi.profiles())}
      />

      <ToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} tools={tools} />
    </div>
  );
}

// ==========================================================================
// 会话列表
// ==========================================================================

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
}: {
  conversations: CollectionAiConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="h-fit max-h-[calc(100vh-16rem)] overflow-y-auto py-0">
      <CardContent className="space-y-1 p-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无会话</p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors',
                conv.id === activeId ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(conv.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[13px]">{conv.title}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {conv.messageCount} 条 · {new Date(conv.updatedAt).toLocaleDateString('zh-CN')}
                  {conv.status === 'awaiting_confirm' ? ' · 待确认' : ''}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onDelete(conv.id)}
                title="删除会话"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ==========================================================================
// 消息气泡
// ==========================================================================

function MessageBubble({
  message,
  toolResults,
  toolLabels,
  busy,
  onConfirm,
}: {
  message: CollectionAiMessage;
  toolResults: Map<string, CollectionAiMessage>;
  toolLabels: Map<string, string>;
  busy: boolean;
  onConfirm: (approve: boolean) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2 text-sm whitespace-pre-wrap text-background">
          {message.content}
        </div>
        <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-muted">
          <User className="size-3.5" />
        </span>
      </div>
    );
  }

  const toolCalls = message.toolCalls ?? [];

  return (
    <div className="flex gap-2">
      <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-muted">
        <Bot className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {message.content ? (
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap">
            {message.content}
          </div>
        ) : null}

        {toolCalls.map((call) => (
          <ToolCallCard
            key={call.id}
            name={call.function.name}
            label={toolLabels.get(call.function.name) ?? call.function.name}
            args={call.function.arguments}
            result={toolResults.get(call.id)?.content ?? null}
            status={message.toolStatus}
          />
        ))}

        {message.toolStatus === 'pending' ? (
          <div className="flex items-center gap-2 pt-0.5">
            <Button size="sm" disabled={busy} onClick={() => onConfirm(true)}>
              <Check className="mr-1.5 size-3.5" />
              确认执行
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onConfirm(false)}>
              <X className="mr-1.5 size-3.5" />
              拒绝
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** 工具结果统一是 {ok, data|error}，解析失败就当没有结构化信息 */
function isFailedResult(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { ok?: boolean };
    return parsed?.ok === false;
  } catch {
    return false;
  }
}

function ToolCallCard({
  name,
  label,
  args,
  result,
  status,
}: {
  name: string;
  label: string;
  args: string;
  result: string | null;
  status: CollectionAiMessage['toolStatus'];
}) {
  const failed = isFailedResult(result);

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-xs',
        status === 'pending'
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
          : status === 'rejected'
            ? 'border-border bg-muted/40 opacity-70'
            : 'border-border bg-muted/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        <code className="text-[11px] text-muted-foreground">{name}</code>
        {status === 'pending' ? (
          <Badge variant="warning" className="text-[10px]">
            待确认
          </Badge>
        ) : status === 'rejected' ? (
          <Badge variant="muted" className="text-[10px]">
            已拒绝
          </Badge>
        ) : failed ? (
          <Badge variant="destructive" className="text-[10px]">
            执行失败
          </Badge>
        ) : result ? (
          <Badge variant="success" className="text-[10px]">
            已执行
          </Badge>
        ) : null}
      </div>

      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
        {prettyJson(args || '{}')}
      </pre>

      {result ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">
            查看执行结果
          </summary>
          <pre className="mt-1 max-h-52 overflow-auto rounded bg-background p-2 text-[11px] whitespace-pre-wrap">
            {prettyJson(result)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

// ==========================================================================
// 空态与引导
// ==========================================================================

function EmptyHint({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="space-y-3">
        <Bot className="mx-auto size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">新建一个会话，开始让 AI 帮你维护采集系统</p>
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-2 size-4" />
          新建会话
        </Button>
      </div>
    </div>
  );
}

const STARTERS = [
  '看一下采集系统现在的整体状态，有没有需要处理的问题',
  '把最近失败的采集任务都重试一遍，并告诉我失败原因',
  '抓取 gv 的第 1 到 5 页列表',
  '把待导入的采集视频取 10 条入库并发布',
  '检查号池账号是否都还有效，失效的标记出来',
];

function StarterHints({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-3 py-6">
      <p className="text-center text-sm text-muted-foreground">试着这样问：</p>
      <div className="mx-auto flex max-w-lg flex-col gap-1.5">
        {STARTERS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="rounded-lg border border-border px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ==========================================================================
// AI 接口配置弹窗
// ==========================================================================

function ProfileDialog({
  open,
  onOpenChange,
  profiles,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profiles: CollectionAiProfile[];
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<ProfileDraft>(DEFAULT_PROFILE_DRAFT);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setNote(null);
      setDraft(DEFAULT_PROFILE_DRAFT);
    }
  }, [open]);

  function edit(profile: CollectionAiProfile) {
    setNote(null);
    setDraft({
      id: profile.id,
      name: profile.name,
      endpoint: profile.endpoint,
      model: profile.model,
      apiKey: profile.apiKey,
      systemPrompt: profile.systemPrompt,
      temperature: profile.temperature,
      maxSteps: profile.maxSteps,
      autoApprove: profile.autoApprove,
      isActive: profile.isActive,
    });
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim(),
        endpoint: draft.endpoint.trim(),
        model: draft.model.trim(),
        systemPrompt: draft.systemPrompt,
        temperature: draft.temperature,
        maxSteps: draft.maxSteps,
        autoApprove: draft.autoApprove,
        isActive: draft.isActive,
      };
      // 脱敏占位符原样回传等于「不修改」，只有真填了新 key 才带上
      if (draft.apiKey && draft.apiKey !== MASKED_KEY) payload.apiKey = draft.apiKey;

      const saved = draft.id
        ? await collectionAiApi.updateProfile(draft.id, payload)
        : await collectionAiApi.createProfile(payload);
      await onChanged();
      edit(saved);
      setNote({ kind: 'ok', text: '已保存' });
    } catch (e) {
      setNote({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!draft.id) {
      setNote({ kind: 'error', text: '请先保存后再测试' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await collectionAiApi.testProfile(draft.id);
      setNote({ kind: 'ok', text: `接口连通，模型回复：${result.reply}` });
    } catch (e) {
      setNote({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setBusy(true);
    try {
      await collectionAiApi.deleteProfile(draft.id);
      await onChanged();
      setDraft(DEFAULT_PROFILE_DRAFT);
      setNote({ kind: 'ok', text: '已删除' });
    } catch (e) {
      setNote({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>AI 接口配置</DialogTitle>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-4 overflow-y-auto md:grid-cols-[200px_minmax(0,1fr)]">
          <div className="space-y-1">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => edit(profile)}
                className={cn(
                  'w-full rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors',
                  draft.id === profile.id ? 'border-foreground bg-accent' : 'border-border hover:bg-accent/60',
                )}
              >
                <span className="block truncate font-medium">{profile.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{profile.model}</span>
                {!profile.isActive ? (
                  <Badge variant="muted" className="mt-1 text-[10px]">
                    已停用
                  </Badge>
                ) : null}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setNote(null);
                setDraft(DEFAULT_PROFILE_DRAFT);
              }}
            >
              <Plus className="mr-2 size-4" />
              新增接口
            </Button>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="如：采集运维助手"
                />
              </div>
              <div className="space-y-1.5">
                <Label>模型</Label>
                <Input
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder="gpt-4o-mini"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>接口地址</Label>
              <Input
                value={draft.endpoint}
                onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
                placeholder="https://api.openai.com/v1/chat/completions"
              />
              <p className="text-[11px] text-muted-foreground">
                OpenAI 兼容协议即可（需支持 function calling）。填 base 地址会自动补 /chat/completions。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder={draft.id ? '留空表示不修改已保存的密钥' : 'sk-...'}
              />
            </div>

            <div className="space-y-1.5">
              <Label>附加系统提示词（可选）</Label>
              <Textarea
                rows={3}
                value={draft.systemPrompt}
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                placeholder="补充你的运维习惯，例如：默认只采 gv，导入后一律设为会员可见"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>temperature</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  value={draft.temperature}
                  onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>单轮最多工具调用轮数</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.maxSteps}
                  onChange={(e) => setDraft({ ...draft, maxSteps: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm">启用</p>
                <p className="text-[11px] text-muted-foreground">未绑定接口的会话会自动用启用中的这个</p>
              </div>
              <Switch
                checked={draft.isActive}
                onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm">新会话默认自动执行写操作</p>
                <p className="text-[11px] text-muted-foreground">
                  开启后 AI 改数据不再逐条问你，单个会话仍可单独关掉
                </p>
              </div>
              <Switch
                checked={draft.autoApprove}
                onCheckedChange={(v) => setDraft({ ...draft, autoApprove: v })}
              />
            </div>

            {note ? (
              <p
                className={cn(
                  'text-xs',
                  note.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                )}
              >
                {note.text}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={!draft.id || busy} onClick={() => void remove()}>
            <Trash2 className="mr-2 size-4" />
            删除
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
              <Plug className="mr-2 size-4" />
              测试连通性
            </Button>
            <Button size="sm" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==========================================================================
// 能力清单弹窗
// ==========================================================================

function ToolsDialog({
  open,
  onOpenChange,
  tools,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tools: CollectionAiToolInfo[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>助手能做的事</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {tools.map((tool) => (
            <div key={tool.name} className="rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{tool.label}</span>
                <code className="text-[11px] text-muted-foreground">{tool.name}</code>
                <Badge variant={tool.readOnly ? 'muted' : 'warning'} className="text-[10px]">
                  {tool.readOnly ? '只读' : '写操作'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
