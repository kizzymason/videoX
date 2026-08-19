import { createSHA256 } from 'hash-wasm';
import { ApiError } from '@videox/shared';
import { putChunk, uploadApi } from './api';

export const CHUNK_SIZE = 8 * 1024 * 1024;
/** 同一文件内并发上传的分片数。太高会把带宽拆碎、反而拖慢单片完成。 */
const CHUNK_CONCURRENCY = 3;
const MAX_CHUNK_RETRIES = 3;

export type UploadPhase = 'queued' | 'hashing' | 'uploading' | 'processing' | 'done' | 'error' | 'canceled';

export interface UploadTask {
  id: string;
  file: File;
  phase: UploadPhase;
  /** 0-100，hashing 与 uploading 各自的百分比 */
  progress: number;
  uploadId: string | null;
  videoId: string | null;
  jobId: string | null;
  instant: boolean;
  error: string | null;
  /** 最近一次测速得到的字节/秒，用于展示剩余时间 */
  bytesPerSecond: number;
}

export interface UploadMeta {
  title?: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  accessLevel: string;
  visibility: string;
  kind: 'shorts' | 'vod';
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 流式算整文件 SHA-256（秒传要用）。
 * subtle.digest 不支持增量，大文件全读进内存会直接把标签页搞崩，
 * 所以这里用 hash-wasm 逐块喂。
 */
async function hashFile(file: File, onProgress: (percent: number) => void, signal: AbortSignal): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const READ_SIZE = 16 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += READ_SIZE) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const slice = file.slice(offset, Math.min(offset + READ_SIZE, file.size));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
    onProgress(Math.min(100, ((offset + READ_SIZE) / file.size) * 100));
  }
  return hasher.digest('hex');
}

/**
 * 单个文件的完整上传流程：算指纹 → init（可能秒传）→ 并发补传缺失分片 → complete。
 * 每一步都把状态回吐给调用方，页面只负责渲染。
 */
export async function runUpload(
  task: UploadTask,
  meta: UploadMeta,
  update: (patch: Partial<UploadTask>) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    update({ phase: 'hashing', progress: 0 });
    const fileHash = await hashFile(task.file, (percent) => update({ progress: percent }), signal);

    const session = await uploadApi.init({
      filename: task.file.name,
      fileSize: task.file.size,
      chunkSize: CHUNK_SIZE,
      fileHash,
      mimeType: task.file.type || undefined,
    });
    update({ uploadId: session.id, phase: 'uploading', progress: 0 });

    if (session.instant) {
      update({ instant: true, progress: 100, phase: 'processing' });
    } else {
      const received = new Set(session.receivedChunks);
      const pending: number[] = [];
      for (let i = 0; i < session.totalChunks; i += 1) if (!received.has(i)) pending.push(i);

      let done = received.size;
      const total = session.totalChunks;
      const startedAt = performance.now();
      let uploadedBytes = 0;
      update({ progress: (done / total) * 100 });

      // 固定大小的 worker 池轮流领取分片序号，比 Promise.all 分批更能吃满带宽。
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          const index = cursor;
          cursor += 1;
          if (index >= pending.length) return;
          const chunkIndex = pending[index]!;
          const start = chunkIndex * session.chunkSize;
          const blob = task.file.slice(start, Math.min(start + session.chunkSize, task.file.size));
          const digest = await sha256Hex(await blob.arrayBuffer());

          let attempt = 0;
          for (;;) {
            try {
              await putChunk(session.id, chunkIndex, blob, digest, signal);
              break;
            } catch (error) {
              if (signal.aborted) throw error;
              attempt += 1;
              if (attempt >= MAX_CHUNK_RETRIES) throw error;
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }

          done += 1;
          uploadedBytes += blob.size;
          const elapsed = (performance.now() - startedAt) / 1000;
          update({
            progress: (done / total) * 100,
            bytesPerSecond: elapsed > 0.5 ? uploadedBytes / elapsed : 0,
          });
        }
      };

      await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, pending.length || 1) }, worker));
      update({ phase: 'processing', progress: 100 });
    }

    const result = await uploadApi.complete(session.id, {
      title: meta.title || stripExtension(task.file.name),
      description: meta.description || undefined,
      categoryId: meta.categoryId || undefined,
      tags: meta.tags?.length ? meta.tags : undefined,
      accessLevel: meta.accessLevel,
      visibility: meta.visibility,
      kind: meta.kind,
    });

    update({
      phase: 'done',
      progress: 100,
      videoId: result.videoId,
      jobId: result.jobId,
      instant: result.instant,
    });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      update({ phase: 'canceled' });
      return;
    }
    const message = error instanceof ApiError || error instanceof Error ? error.message : '上传失败';
    update({ phase: 'error', error: message });
  }
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '');
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '—';
  const mb = bytesPerSecond / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

export function formatEta(remainingBytes: number, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0 || remainingBytes <= 0) return '';
  const seconds = remainingBytes / bytesPerSecond;
  if (seconds < 60) return `剩余 ${Math.ceil(seconds)} 秒`;
  if (seconds < 3600) return `剩余 ${Math.ceil(seconds / 60)} 分钟`;
  return `剩余 ${(seconds / 3600).toFixed(1)} 小时`;
}
