import { describe, expect, it } from 'vitest';
import {
  BROWSE_PAGE_SIZE,
  parseHomeSort,
  siteSettingsSchema,
} from '@videox/shared';

describe('browse mode defaults', () => {
  it('defaults site browse mode to paged', () => {
    const parsed = siteSettingsSchema.parse({ siteName: 'PandaGV' });
    expect(parsed.defaultBrowseMode).toBe('paged');
  });

  it('keeps video list page size at 20', () => {
    expect(BROWSE_PAGE_SIZE).toBe(20);
  });

  it('parses home sort from the query string', () => {
    expect(parseHomeSort('latest')).toBe('latest');
    expect(parseHomeSort('popular')).toBe('popular');
    expect(parseHomeSort('most_liked')).toBe('most_liked');
    expect(parseHomeSort(null)).toBe('recommended');
    expect(parseHomeSort('nope')).toBe('recommended');
  });
});
