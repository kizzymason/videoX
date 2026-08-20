import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ROWS,
  buildLlmMessages,
  trimHistory,
  type StoredMessage,
} from '../apps/api/src/modules/collection/ai/history.ts';

const SYSTEM = '你是采集系统运维助手';

const user = (content: string): StoredMessage => ({ role: 'user', content });

const assistantCalling = (callIds: string[], content = ''): StoredMessage => ({
  role: 'assistant',
  content,
  toolCalls: callIds.map((id) => ({
    id,
    type: 'function',
    function: { name: 'get_overview', arguments: '{}' },
  })),
});

const toolReply = (toolCallId: string, content = '{"ok":true}'): StoredMessage => ({
  role: 'tool',
  content,
  toolCallId,
});

describe('AI 维护对话历史拼装', () => {
  it('系统提示词永远排在第一条', () => {
    const messages = buildLlmMessages([user('你好')], SYSTEM);
    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(messages[1]).toEqual({ role: 'user', content: '你好' });
  });

  it('完整的一轮工具调用会带上 tool_calls 与配对的 tool 回复', () => {
    const messages = buildLlmMessages(
      [user('看下状态'), assistantCalling(['call_1']), toolReply('call_1'), { role: 'assistant', content: '一切正常' }],
      SYSTEM,
    );

    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
    expect(messages[2]!.tool_calls?.[0]?.id).toBe('call_1');
    expect(messages[3]!.tool_call_id).toBe('call_1');
  });

  it('待确认（还没执行）的工具调用不进历史，避免缺 tool 回复导致接口报错', () => {
    const messages = buildLlmMessages([user('删个账号'), assistantCalling(['call_pending'])], SYSTEM);

    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('一次多个调用时只要有一个没回复，整条 assistant 消息都要丢掉', () => {
    const messages = buildLlmMessages(
      [user('批量处理'), assistantCalling(['call_a', 'call_b']), toolReply('call_a')],
      SYSTEM,
    );

    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('找不到发起方的孤儿 tool 消息会被丢弃', () => {
    const messages = buildLlmMessages([user('继续'), toolReply('call_ghost')], SYSTEM);

    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('没有内容也没有工具调用的 assistant 消息不占位', () => {
    const messages = buildLlmMessages([user('在吗'), { role: 'assistant', content: '' }], SYSTEM);

    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('截断历史时对齐到 user 消息，不会从半截工具调用开始', () => {
    const rows: StoredMessage[] = [];
    for (let i = 0; i < 40; i += 1) {
      rows.push(user(`第 ${i} 轮`), assistantCalling([`call_${i}`]), toolReply(`call_${i}`));
    }

    const trimmed = trimHistory(rows);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_HISTORY_ROWS);
    expect(trimmed[0]!.role).toBe('user');

    // 拼出来的消息里，每个 tool 回复都能找到同 id 的 assistant 调用
    const messages = buildLlmMessages(rows, SYSTEM);
    const declared = new Set(messages.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []));
    for (const message of messages) {
      if (message.role === 'tool') expect(declared.has(message.tool_call_id!)).toBe(true);
    }
  });
});
