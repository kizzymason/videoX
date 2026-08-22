import { describe, expect, it } from 'vitest';
import {
  collectedDedupeScore,
  groupDuplicateRows,
  normalizeDedupeTitle,
  pickCollectedDedupeWinner,
  type CollectedDedupeCandidate,
} from '@videox/shared';

const row = (partial: Partial<CollectedDedupeCandidate> & Pick<CollectedDedupeCandidate, 'id'>): CollectedDedupeCandidate => ({
  externalId: partial.externalId ?? partial.id,
  title: partial.title ?? 'Same Title',
  kind: partial.kind ?? 'gv',
  status: partial.status ?? 'pending',
  videoId: partial.videoId ?? null,
  externalPlayUrl: partial.externalPlayUrl ?? null,
  updatedAt: partial.updatedAt ?? '2026-08-22T00:00:00.000Z',
  ...partial,
});

describe('采集去重', () => {
  it('按外部 ID 和标题归组重复项', () => {
    const items = [
      row({ id: 'a', externalId: '1', title: 'Hello' }),
      row({ id: 'b', externalId: '1', title: 'Hello again' }),
      row({ id: 'c', externalId: '2', title: '  HELLO  ' }),
      row({ id: 'd', externalId: '3', title: 'Unique' }),
    ];
    const byId = groupDuplicateRows(items, (item) => `id:${item.externalId}`);
    expect(byId).toHaveLength(1);
    expect(byId[0]?.map((item) => item.id)).toEqual(['a', 'b']);

    const byTitle = groupDuplicateRows(items, (item) => `title:${normalizeDedupeTitle(item.title)}`);
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]?.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('保留已导入记录，丢掉同标题的待导入副本', () => {
    const imported = row({
      id: 'keep',
      status: 'imported',
      videoId: 'video-1',
      externalPlayUrl: 'https://play.example/a',
    });
    const pending = row({ id: 'drop', status: 'pending' });
    const { keep, drop } = pickCollectedDedupeWinner([pending, imported]);
    expect(keep.id).toBe('keep');
    expect(drop.map((item) => item.id)).toEqual(['drop']);
    expect(collectedDedupeScore(imported)).toBeGreaterThan(collectedDedupeScore(pending));
  });
});
