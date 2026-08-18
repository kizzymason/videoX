/**
 * 生成三端的 favicon 与 PWA 图标。品牌标记是黑底白色播放三角，
 * 与设计系统「白底黑强调」一致，直接用 sharp 从 SVG 栅格化。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const mark = (size, radius, scale) => {
  const c = size / 2;
  const r = (size * scale) / 2;
  // 等边三角形内切于圆，重心补偿让视觉居中
  const p = `${c - r * 0.52},${c - r * 0.62} ${c - r * 0.52},${c + r * 0.62} ${c + r * 0.66},${c}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#0a0a0a"/>
  <polygon points="${p}" fill="#ffffff"/>
</svg>`;
};

const targets = [
  { app: 'web-mobile', files: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'] },
  { app: 'web-pc', files: ['favicon.svg'] },
  { app: 'admin', files: ['favicon.svg'] },
];

for (const { app, files } of targets) {
  const dir = resolve(root, 'apps', app, 'public');
  await mkdir(dir, { recursive: true });

  for (const file of files) {
    const out = resolve(dir, file);
    if (file.endsWith('.svg')) {
      await writeFile(out, mark(64, 14, 0.5));
      continue;
    }
    const size = file === 'icon-192.png' ? 192 : 512;
    // maskable 需要留出 20% 安全边距，否则被系统裁圆时会切到图形
    const scale = file === 'icon-maskable.png' ? 0.34 : 0.5;
    const radius = file === 'icon-maskable.png' ? 0 : Math.round(size * 0.22);
    await sharp(Buffer.from(mark(size, radius, scale))).png({ compressionLevel: 9 }).toFile(out);
  }
  console.log(`icons -> apps/${app}/public`);
}
