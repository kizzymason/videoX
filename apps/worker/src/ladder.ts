import { RENDITION_LADDER, FAST_START_RENDITION, HLS_GOP_SECONDS, type RenditionSpec } from '@videox/shared';
import type { ProbeResult } from './ffmpeg.js';

export interface PlannedRendition extends RenditionSpec {
  width: number;
  /** 供 master.m3u8 用的声明带宽（视频 + 音频，留 10% 余量） */
  bandwidth: number;
}

/** 保证偶数：libx264 的 yuv420p 要求宽高都能被 2 整除。 */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * 根据源分辨率裁剪 ABR 阶梯。
 *
 * 两条硬规则：
 *  1. 绝不上采样——把 480p 拉成 1080p 只会浪费码率还更糊；
 *  2. 至少产出一档——哪怕源只有 180p，也要给一个能播的档位。
 *
 * 排序上把 FAST_START_RENDITION（360p）提到最前，让它最先产出，
 * 视频随即进入 partially_ready 可播状态。
 */
export function planLadder(probe: ProbeResult): PlannedRendition[] {
  const sourceHeight = Math.max(probe.width, probe.height) > 0 ? probe.height : 0;
  const aspect = probe.width > 0 && probe.height > 0 ? probe.width / probe.height : 16 / 9;

  let specs = RENDITION_LADDER.filter((spec) => spec.height <= sourceHeight);
  if (specs.length === 0) {
    // 源比最低档还小：按源分辨率单档输出，码率沿用最低档。
    specs = [{ ...RENDITION_LADDER[0]!, height: even(sourceHeight || 240) }];
  }

  const planned = specs.map<PlannedRendition>((spec) => ({
    ...spec,
    width: even(spec.height * aspect),
    height: even(spec.height),
    bandwidth: Math.round((spec.videoBitrate + spec.audioBitrate) * 1000 * 1.1),
  }));

  return planned.sort((a, b) => {
    if (a.name === FAST_START_RENDITION) return -1;
    if (b.name === FAST_START_RENDITION) return 1;
    return a.height - b.height;
  });
}

/**
 * 构造单档转码参数。
 *
 * 关键点是**跨档关键帧对齐**：所有档位用同一个 GOP 长度、关闭场景切换插帧
 * （`-sc_threshold 0`）并强制固定 `-g`，这样 ABR 切换时才能无缝对齐分片边界。
 */
export function buildRenditionArgs(params: {
  input: string;
  outputDir: string;
  rendition: PlannedRendition;
  fps: number;
  hasAudio: boolean;
  preset: string;
  segmentSeconds: number;
  /** 传入则启用 HLS AES-128 全片加密 */
  keyInfoFile?: string;
  encoder: 'libx264' | 'h264_nvenc' | 'h264_qsv';
}): string[] {
  const { rendition, fps, hasAudio, preset, segmentSeconds, encoder } = params;
  const gop = Math.max(2, Math.round(fps * HLS_GOP_SECONDS));

  const args = ['-i', params.input, '-map', '0:v:0'];
  if (hasAudio) args.push('-map', '0:a:0');

  args.push(
    '-vf',
    `scale=${rendition.width}:${rendition.height}:force_original_aspect_ratio=decrease,pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-c:v',
    encoder,
  );

  if (encoder === 'libx264') {
    args.push('-preset', preset, '-profile:v', 'high', '-level', '4.1', '-sc_threshold', '0');
  } else {
    // 硬编码器没有 -sc_threshold，用 no-scenecut 等价开关。
    args.push('-preset', 'p4', '-profile:v', 'high');
  }

  args.push(
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-force_key_frames',
    `expr:gte(t,n_forced*${HLS_GOP_SECONDS})`,
    // capped VBR：平均码率受控，复杂场景允许冲高到 maxrate，画质比 CBR 稳。
    '-b:v',
    `${rendition.videoBitrate}k`,
    '-maxrate',
    `${rendition.maxrate}k`,
    '-bufsize',
    `${rendition.bufsize}k`,
    '-pix_fmt',
    'yuv420p',
  );

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', `${rendition.audioBitrate}k`, '-ac', '2', '-ar', '48000');
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(segmentSeconds),
    '-hls_playlist_type',
    'vod',
    '-hls_list_size',
    '0',
    '-hls_flags',
    'independent_segments',
  );

  if (params.keyInfoFile) {
    // AES-128 全片加密时退回 MPEG-TS 分片：ffmpeg 的 hls 加密对 fMP4 支持不完整，
    // 而 TS + AES-128 是 HLS 里兼容性最好的加密组合（hls.js 与原生播放器都支持）。
    args.push('-hls_key_info_file', params.keyInfoFile, '-hls_segment_type', 'mpegts');
    args.push('-hls_segment_filename', `${params.outputDir}/seg-%05d.ts`);
  } else {
    args.push('-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4');
    args.push('-hls_segment_filename', `${params.outputDir}/seg-%05d.m4s`);
  }

  args.push(`${params.outputDir}/index.m3u8`);
  return args;
}
