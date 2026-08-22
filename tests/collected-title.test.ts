import { describe, expect, it } from 'vitest';
import { resolveCollectedTitle } from '../apps/api/src/modules/collection/storage/ingestor.ts';

const LONG_TITLE =
  'tylerwu-A Homework Call, with Dane Jaxson. What a core memory! Remember when I first started to do [virtual] collabs during the lockdowns? I was so nervous to meet this goofball, but so glad I did. We ended up making something I still think about.';

describe('采集标题入库', () => {
  it('保留超过 200 字的源站标题，不再截断', () => {
    expect(LONG_TITLE.length).toBeGreaterThan(200);
    expect(resolveCollectedTitle(LONG_TITLE, '1000003712')).toBe(LONG_TITLE);
  });

  it('空白标题回落到可落库的占位，避免 NOT NULL 失败', () => {
    expect(resolveCollectedTitle('   ', '1000003712')).toBe('未命名 1000003712');
    expect(resolveCollectedTitle(undefined, '9')).toBe('未命名 9');
  });
});
