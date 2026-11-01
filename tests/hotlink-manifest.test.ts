import { describe, expect, it } from 'vitest';
import {
  absolutizePlaylist,
  bitrateKbpsOf,
  buildHotlinkMaster,
  hotlinkVariants,
  resolutionFor,
} from '../apps/api/src/modules/media/hotlink-manifest';

const BASE = 'https://yi.example.com/api/media/1793527781/abc/data/def/1800/index.m3u8';

describe('热链多清晰度清单', () => {
  it('从路径里取码率，带查询串也能取到', () => {
    expect(bitrateKbpsOf('https://a/api/media/1/x/data/y/1800/index.m3u8')).toBe(1800);
    expect(bitrateKbpsOf('https://a/api/media/1/x/data/y/450/index.m3u8?t=1&k=2')).toBe(450);
    expect(bitrateKbpsOf('https://a/api/media/1/x/data/y/index.m3u8')).toBe(0);
  });

  it('档位标签决定分辨率，认不出时按码率兜底', () => {
    expect(resolutionFor('高清', 1800)).toEqual({ width: 1920, height: 1080 });
    expect(resolutionFor('标清', 900)).toEqual({ width: 1280, height: 720 });
    expect(resolutionFor('流畅', 450)).toEqual({ width: 854, height: 480 });
    expect(resolutionFor('未知', 2000)).toEqual({ width: 1920, height: 1080 });
    expect(resolutionFor('未知', 900)).toEqual({ width: 1280, height: 720 });
    expect(resolutionFor('未知', 300)).toEqual({ width: 854, height: 480 });
  });

  it('master 里低码率在前，但 q 下标仍对应原始档位', () => {
    const qualities = [
      { label: '流畅', url: 'https://a/x/450/index.m3u8' },
      { label: '标清', url: 'https://a/x/900/index.m3u8' },
      { label: '高清', url: 'https://a/x/1800/index.m3u8' },
    ];
    const master = buildHotlinkMaster(qualities);
    const streamLines = master.split('\n').filter((line) => line.startsWith('#EXT-X-STREAM-INF'));

    expect(streamLines).toHaveLength(3);
    expect(streamLines[0]).toContain('RESOLUTION=854x480');
    expect(streamLines[2]).toContain('RESOLUTION=1920x1080');

    // 排序后第一档是 450k，但它的目录名必须是 q0（原始下标），否则切档会串。
    const uris = master.split('\n').filter((line) => line.startsWith('q'));
    expect(uris).toEqual(['q0/index.m3u8', 'q1/index.m3u8', 'q2/index.m3u8']);
    expect(hotlinkVariants(qualities).map((v) => v.bandwidth)).toEqual([450000, 900000, 1800000]);
  });

  it('把相对的分片与密钥补成绝对地址，绝对地址保持不变', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
      '#EXTINF:10,',
      'index0.js?t=1',
      '#EXTINF:10,',
      'https://cdn.example.com/other/index1.js?t=2',
    ].join('\n');

    const out = absolutizePlaylist(playlist, BASE);

    expect(out).toContain('URI="https://yi.example.com/api/media/1793527781/abc/data/def/1800/key.key"');
    expect(out).toContain('https://yi.example.com/api/media/1793527781/abc/data/def/1800/index0.js?t=1');
    expect(out).toContain('https://cdn.example.com/other/index1.js?t=2');
  });
});
