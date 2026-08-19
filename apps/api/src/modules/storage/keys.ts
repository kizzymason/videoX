/** 存储对象键。路径约定以 schema 注释为准，秒传克隆靠同一套键复用产物。 */
export const StorageKeys = {
  source(videoId: string, ext: string): string {
    const clean = ext.replace(/^\./, '').toLowerCase() || 'mp4';
    return `videos/${videoId}/source.${clean}`;
  },
  hlsDir(videoId: string): string {
    return `hls/${videoId}`;
  },
  master(videoId: string): string {
    return `hls/${videoId}/master.m3u8`;
  },
  renditionPlaylist(videoId: string, name: string): string {
    return `hls/${videoId}/${name}/index.m3u8`;
  },
  poster(videoId: string): string {
    return `assets/${videoId}/poster.jpg`;
  },
  verticalPoster(videoId: string): string {
    return `assets/${videoId}/poster-vertical.jpg`;
  },
  sprite(videoId: string): string {
    return `assets/${videoId}/sprite.jpg`;
  },
  spriteVtt(videoId: string): string {
    return `assets/${videoId}/thumbnails.vtt`;
  },
  preview(videoId: string): string {
    return `assets/${videoId}/preview.mp4`;
  },
  caption(videoId: string, language: string, ext: string): string {
    const clean = ext.replace(/^\./, '').toLowerCase();
    return `assets/${videoId}/caption-${language}.${clean}`;
  },
} as const;
