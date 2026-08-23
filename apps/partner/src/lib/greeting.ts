import type { PartnerOverview } from '@videox/shared';

export interface Greeting {
  /** 「早上好」这类时段问候 */
  hello: string;
  /** 跟着时段走的一句话，控制在 20 字内，手机上单行放得下 */
  line: string;
}

const SLOTS: Array<{ until: number; hello: string; lines: string[] }> = [
  { until: 5, hello: '夜深了', lines: ['夜里下单的客户也在，数据照常统计。', '早点休息，明天的转化交给白天。'] },
  { until: 9, hello: '早上好', lines: ['新的一天，先看看昨天的成交。', '早起的合伙人，先人一步抢到客户。'] },
  { until: 12, hello: '上午好', lines: ['上午是发码高峰，别忘了备货。', '趁着精神好，把待续费客户过一遍。'] },
  { until: 14, hello: '中午好', lines: ['吃饭前花一分钟看看今天的收入。', '午间流量小高峰，适合推一波续费。'] },
  { until: 18, hello: '下午好', lines: ['下午茶时间，顺手清一清将到期客户。', '稳住节奏，今天的目标还差一点点。'] },
  { until: 23, hello: '晚上好', lines: ['晚上是激活高峰，留意库存还够不够。', '今天辛苦了，收个尾看看战绩。'] },
  { until: 24, hello: '夜深了', lines: ['数据会一直跑，你可以先休息。', '收工前确认下未使用的卡密。'] },
];

export function timeGreeting(seed = new Date()): Greeting {
  const hour = seed.getHours();
  const slot = SLOTS.find((item) => hour < item.until) ?? SLOTS[SLOTS.length - 1]!;
  // 按「日期 + 时段」取句子：同一时段内文案稳定，不会因为重渲染乱跳。
  const index = (seed.getDate() + hour) % slot.lines.length;
  return { hello: slot.hello, line: slot.lines[index]! };
}

/**
 * 经营提示：按紧急程度取第一条命中的。
 * 顺序即优先级——配额见底和客户将到期比「今天没成交」更需要立刻处理。
 */
export function businessTip(overview: PartnerOverview | undefined): string | null {
  if (!overview) return null;
  if (overview.codeQuota > 0 && overview.codeRemaining === 0) return '订阅码额度已用完，联系总站补充后才能继续生成。';
  if (overview.daysRemaining === 0 && overview.daysQuota > 0) return '可发放天数已用完，续期和发码都会被拦下。';
  if (overview.expiringSoonCount > 0) return `有 ${overview.expiringSoonCount} 位客户 7 天内到期，适合发一轮续费提醒。`;
  if (overview.codeQuota > 0 && overview.codeRemaining <= Math.max(1, Math.round(overview.codeQuota * 0.1)))
    return `订阅码只剩 ${overview.codeRemaining} 张，记得提前申请额度。`;
  if (overview.unusedCodeCount > 0) return `还有 ${overview.unusedCodeCount} 张卡密没卖出去，可以安排一次推广。`;
  if (overview.customerCount === 0) return '还没有客户激活，先生成一批订阅码试试水。';
  return null;
}
