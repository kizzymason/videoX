import * as React from 'react';
import { BASE_URL, getAccessToken, type LiveTranscodeJob } from '../lib/api';

interface StreamState {
  jobs: LiveTranscodeJob[];
  connected: boolean;
}

/**
 * 订阅 /admin/transcode/stream。
 *
 * EventSource 不能带 Authorization 头，而后台鉴权只认 Bearer，
 * 所以这里用 fetch + ReadableStream 手写 SSE 解析，并在断线时退避重连。
 */
export function useTranscodeStream(enabled = true): StreamState {
  const [state, setState] = React.useState<StreamState>({ jobs: [], connected: false });

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const connect = async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${BASE_URL}/admin/transcode/stream`, {
          credentials: 'include',
          signal: controller.signal,
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        attempt = 0;
        setState((prev) => ({ ...prev, connected: true }));

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;

          // SSE 以空行分帧，可能一次读到多帧或半帧。
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');

            const payload = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('');
            if (!payload) continue;
            try {
              setState({ jobs: JSON.parse(payload) as LiveTranscodeJob[], connected: true });
            } catch {
              /* 半帧或心跳，忽略 */
            }
          }
        }
        throw new Error('stream closed');
      } catch {
        if (closed || controller.signal.aborted) return;
        setState((prev) => ({ ...prev, connected: false }));
        attempt += 1;
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 15_000));
      }
    };

    void connect();

    return () => {
      closed = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled]);

  return state;
}
