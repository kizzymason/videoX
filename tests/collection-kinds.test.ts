import { describe, expect, it } from 'vitest';
import { normalizeScheduleKinds } from '../packages/shared/src/collection-kinds.js';

describe('normalizeScheduleKinds', () => {
  it('只保留 gv/mv/tv，并保持固定顺序', () => {
    expect(normalizeScheduleKinds(['tv', 'gv', 'mv', 'gv'])).toEqual(['gv', 'mv', 'tv']);
  });

  it('缺省、空数组、脏数据都当成未选择，不回落到全部类型', () => {
    expect(normalizeScheduleKinds(undefined)).toEqual([]);
    expect(normalizeScheduleKinds(null)).toEqual([]);
    expect(normalizeScheduleKinds('gv')).toEqual([]);
    expect(normalizeScheduleKinds(['all', '', 'GV '])).toEqual(['gv']);
  });
});
