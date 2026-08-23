import { describe, expect, it } from 'vitest';
import { keywordScore, normalizeHomeKeyword, prependPins, type HomeKeyword } from '../apps/api/src/modules/recommend/home-ops.js';

const boost = (keyword: string, weight = 1): HomeKeyword => ({ keyword, direction: 'boost', weight });
const penalty = (keyword: string, weight = 1): HomeKeyword => ({ keyword, direction: 'penalty', weight });

describe('keywordScore', () => {
  it('升权命中标题加分，降权命中减分', () => {
    const keywords = [boost('独家', 2), penalty('广告', 1.5)];
    expect(keywordScore('独家纪录片', keywords)).toBeCloseTo(2, 6);
    expect(keywordScore('广告合集', keywords)).toBeCloseTo(-1.5, 6);
    expect(keywordScore('独家广告片', keywords)).toBeCloseTo(0.5, 6);
  });

  it('大小写不敏感，没命中就是 0', () => {
    expect(keywordScore('JAV Studio', [boost('jav', 3)])).toBeCloseTo(3, 6);
    expect(keywordScore('普通标题', [boost('jav', 3)])).toBe(0);
  });

  it('空白关键词会被忽略', () => {
    expect(keywordScore('任何标题', [boost('   '), penalty('')])).toBe(0);
  });
});

describe('prependPins', () => {
  it('置顶排在默认推荐前面，并去掉后面的重复', () => {
    const pins = [{ id: 'p1' }, { id: 'p2' }];
    const items = [{ id: 'a' }, { id: 'p1' }, { id: 'b' }];
    expect(prependPins(pins, items).map((item) => item.id)).toEqual(['p1', 'p2', 'a', 'b']);
  });

  it('置顶自身去重，空置顶时保持原顺序', () => {
    expect(prependPins([{ id: 'x' }, { id: 'x' }], [{ id: 'y' }]).map((item) => item.id)).toEqual(['x', 'y']);
    expect(prependPins([], [{ id: 'a' }, { id: 'b' }]).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('normalizeHomeKeyword', () => {
  it('去掉首尾空白和 SQL 通配符，并截断长度', () => {
    expect(normalizeHomeKeyword('  独家%片_  ')).toBe('独家片');
    expect(normalizeHomeKeyword('a'.repeat(100))).toHaveLength(80);
  });
});
