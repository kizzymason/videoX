// ========================================================================
// 采集系统 - AI 维护：对话历史 → OpenAI messages
//
// 单独拆出来是因为这段最容易出错：OpenAI 协议要求每个 tool 消息前面必须有
// 携带同 id 的 assistant 消息，缺一个就整轮 400。这里不碰数据库，可单测。
// ========================================================================

import type { LlmMessage, LlmToolCall } from './llm.js';

/** 只取用得上的字段，方便测试构造，也与 drizzle 行结构兼容 */
export interface StoredMessage {
  role: string;
  content: string;
  toolCalls?: unknown;
  toolCallId?: string | null;
}

/** 送进模型的历史条数上限，再多既没意义又烧钱 */
export const MAX_HISTORY_ROWS = 60;

/**
 * 从尾部截取历史，并对齐到最近一条 user 消息，
 * 避免开头挂着找不到发起方的孤儿 tool 消息。
 */
export function trimHistory<T extends StoredMessage>(rows: T[]): T[] {
  const tail = rows.slice(-MAX_HISTORY_ROWS);
  const firstUser = tail.findIndex((row) => row.role === 'user');
  return firstUser <= 0 ? tail : tail.slice(firstUser);
}

function readToolCalls(value: unknown): LlmToolCall[] {
  return Array.isArray(value) ? (value as LlmToolCall[]) : [];
}

export function buildLlmMessages(rows: StoredMessage[], systemPrompt: string): LlmMessage[] {
  const history = trimHistory(rows);
  const repliedCallIds = new Set(
    history.filter((row) => row.role === 'tool' && row.toolCallId).map((row) => row.toolCallId!),
  );

  const messages: LlmMessage[] = [{ role: 'system', content: systemPrompt }];
  const acceptedCallIds = new Set<string>();

  for (const row of history) {
    if (row.role === 'user') {
      messages.push({ role: 'user', content: row.content });
      continue;
    }

    if (row.role === 'assistant') {
      const toolCalls = readToolCalls(row.toolCalls);
      if (toolCalls.length === 0) {
        if (row.content) messages.push({ role: 'assistant', content: row.content });
        continue;
      }
      // 还没执行（或执行到一半崩了）的调用不能进历史，模型会因为缺 tool 回复报错
      if (!toolCalls.every((call) => repliedCallIds.has(call.id))) continue;
      toolCalls.forEach((call) => acceptedCallIds.add(call.id));
      messages.push({ role: 'assistant', content: row.content, tool_calls: toolCalls });
      continue;
    }

    if (row.role === 'tool' && row.toolCallId && acceptedCallIds.has(row.toolCallId)) {
      messages.push({ role: 'tool', content: row.content, tool_call_id: row.toolCallId });
    }
  }

  return messages;
}
