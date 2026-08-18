import { spawn } from 'node:child_process';
import readline from 'node:readline';
import ffmpegPath from 'ffmpeg-static';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

export const FFMPEG_BIN = ffmpegPath ?? 'ffmpeg';
export const FFPROBE_BIN = ffprobeInstaller.path;

export interface ProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number;
  /** 竖屏素材（含 rotate 元数据修正后）走不同的封面裁剪策略 */
  isPortrait: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

function parseFraction(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/').map(Number);
  if (!num || !den) return Number(value) || 0;
  return num / den;
}

export async function probe(filePath: string): Promise<ProbeResult> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath];
  const raw = await execCapture(FFPROBE_BIN, args);
  const parsed = JSON.parse(raw) as {
    streams?: FfprobeStream[];
    format?: { duration?: string; bit_rate?: string };
  };

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video) throw new Error('源文件不含视频轨，无法转码');

  const rotation = Math.abs(
    video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? Number(video.tags?.rotate ?? 0),
  );
  const swapped = rotation === 90 || rotation === 270;
  const width = (swapped ? video.height : video.width) ?? 0;
  const height = (swapped ? video.width : video.height) ?? 0;

  const fps = parseFraction(video.avg_frame_rate) || parseFraction(video.r_frame_rate) || 25;
  const duration = Number(parsed.format?.duration ?? video.duration ?? 0);

  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    width,
    height,
    fps: Math.min(120, Math.max(1, Math.round(fps * 1000) / 1000)),
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name ?? 'unknown',
    audioCodec: audio?.codec_name ?? null,
    bitrate: Number(parsed.format?.bit_rate ?? 0),
    isPortrait: height > width,
  };
}

function execCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} 退出码 ${code}：${stderr.slice(-800)}`));
    });
  });
}

export interface RunFfmpegOptions {
  args: string[];
  /** 总时长，用于把 -progress 的 out_time_us 换算成百分比 */
  totalSeconds?: number;
  onProgress?: (percent: number, speed: string) => void;
  signal?: AbortSignal;
}

/**
 * 直接 spawn ffmpeg 并解析 `-progress pipe:1` 的键值流拿实时进度。
 *
 * 不用 fluent-ffmpeg：它靠正则匹配 stderr 的人类可读输出，ffmpeg 换个版本
 * 就可能解析不到；`-progress` 是官方的机器可读通道，稳定得多。
 */
export function runFfmpeg(options: RunFfmpegOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-y', ...options.args];
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true });

    let stderr = '';
    let speed = '0x';
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new Error('转码已取消'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const idx = line.indexOf('=');
      if (idx < 0) return;
      const key = line.slice(0, idx);
      const value = line.slice(idx + 1);

      if (key === 'speed') speed = value.trim();
      if (key === 'out_time_us' && options.totalSeconds && options.onProgress) {
        const seconds = Number(value) / 1_000_000;
        if (Number.isFinite(seconds) && seconds >= 0) {
          options.onProgress(Math.min(100, (seconds / options.totalSeconds) * 100), speed);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // 只留尾部：ffmpeg 出错时有用的信息基本都在最后几行。
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      rl.close();
      if (code === 0) finish();
      else finish(new Error(`ffmpeg 退出码 ${code}：${stderr.trim().slice(-800) || '无错误输出'}`));
    });
  });
}
