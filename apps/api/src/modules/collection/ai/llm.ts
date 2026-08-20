// ========================================================================
// 采集系统 - AI 维护：OpenAI 兼容 Chat Completions 客户端
// 与 worker 里的 AI 评分一样手写 fetch，不引入 SDK；区别是这里要带 tools。
// ========================================================================

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmCompletion {
  content: string;
  toolCalls: LlmToolCall[];
}

export interface LlmRequest {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  timeoutMs?: number;
}

/** 填 base 地址时自动补全路径，与 worker 的 AI 评分保持一致。 */
export function resolveChatEndpoint(endpoint: string): string {
  return /\/(chat\/)?completions$/.test(endpoint)
    ? endpoint
    : `${endpoint.replace(/\/+$/, '')}/chat/completions`;
}

interface RawChoice {
  message?: {
    content?: string | null;
    tool_calls?: {
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
}

/**
 * 兼容各家 OpenAI 协议实现的 tool_calls：
 * 部分网关会漏掉 id 或把 arguments 给成对象，这里统一收敛成标准形状，
 * 不然后面拼 tool 消息时 tool_call_id 对不上，模型会直接报 400。
 */
function normalizeToolCalls(raw: RawChoice['message']): LlmToolCall[] {
  const list = raw?.tool_calls ?? [];
  return list
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id ?? `call_${index}_${Date.now()}`,
      type: 'function' as const,
      function: {
        name: call.function!.name!,
        arguments:
          typeof call.function!.arguments === 'string'
            ? call.function!.arguments
            : JSON.stringify(call.function!.arguments ?? {}),
      },
    }));
}

export async function chatCompletion(request: LlmRequest): Promise<LlmCompletion> {
  const url = resolveChatEndpoint(request.endpoint);

  const payload: Record<string, unknown> = {
    model: request.model,
    temperature: request.temperature,
    messages: request.messages,
  };
  if (request.tools?.length) {
    payload.tools = request.tools;
    payload.tool_choice = 'auto';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`调用 AI 接口失败：${reason}`);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`AI 接口返回 ${response.status}：${detail}`);
  }

  const bodyJson = (await response.json()) as { choices?: RawChoice[] };
  const message = bodyJson.choices?.[0]?.message;

  return {
    content: message?.content ?? '',
    toolCalls: normalizeToolCalls(message),
  };
}
