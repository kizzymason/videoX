/** 手动全量抓取：按结束页自动切批，避免一次把源站和队列打满。 */

export const FULL_CRAWL_END_PAGE_MAX = 20_000;
export const FULL_CRAWL_PAGES_PER_BATCH_MAX = 500;
export const FULL_CRAWL_BATCH_INTERVAL_SECONDS_MAX = 3600;
export const FULL_CRAWL_PAGE_DELAY_MS = 500;

export interface FullCrawlPlan {
  endPage: number;
  pagesPerBatch: number;
  batchIntervalSeconds: number;
  batchCount: number;
  lastBatchPages: number;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function planFullCrawl(params: {
  endPage?: number;
  maxPages?: number;
  pagesPerBatch?: number;
  batchIntervalSeconds?: number;
} = {}): FullCrawlPlan {
  const endPage = clampInt(params.endPage ?? params.maxPages ?? 200, 1, FULL_CRAWL_END_PAGE_MAX);
  const pagesPerBatch = clampInt(
    params.pagesPerBatch ?? 140,
    1,
    Math.min(FULL_CRAWL_PAGES_PER_BATCH_MAX, endPage),
  );
  const batchIntervalSeconds = clampInt(
    params.batchIntervalSeconds ?? 60,
    0,
    FULL_CRAWL_BATCH_INTERVAL_SECONDS_MAX,
  );
  const batchCount = Math.ceil(endPage / pagesPerBatch);
  const lastBatchPages = endPage - (batchCount - 1) * pagesPerBatch;
  return { endPage, pagesPerBatch, batchIntervalSeconds, batchCount, lastBatchPages };
}

/** 刚完成 `page` 后，若还没到结束页且正好是一批末尾，则等待批次间隔。 */
export function nextFullCrawlDelayMs(page: number, plan: FullCrawlPlan): number {
  if (page < plan.endPage && page % plan.pagesPerBatch === 0) {
    return Math.max(FULL_CRAWL_PAGE_DELAY_MS, plan.batchIntervalSeconds * 1000);
  }
  return FULL_CRAWL_PAGE_DELAY_MS;
}

export function fullCrawlBatchIndex(page: number, pagesPerBatch: number): number {
  return Math.floor((Math.max(1, page) - 1) / pagesPerBatch) + 1;
}

export function describeFullCrawlPlan(plan: FullCrawlPlan): string {
  if (plan.batchCount === 1) {
    return `第 1–${plan.endPage} 页，共 1 批`;
  }
  if (plan.lastBatchPages === plan.pagesPerBatch) {
    return `第 1–${plan.endPage} 页，自动分成 ${plan.batchCount} 批，每批 ${plan.pagesPerBatch} 页，批间隔 ${plan.batchIntervalSeconds} 秒`;
  }
  return `第 1–${plan.endPage} 页，自动分成 ${plan.batchCount} 批（前 ${plan.batchCount - 1} 批各 ${plan.pagesPerBatch} 页，最后一批 ${plan.lastBatchPages} 页），批间隔 ${plan.batchIntervalSeconds} 秒`;
}
