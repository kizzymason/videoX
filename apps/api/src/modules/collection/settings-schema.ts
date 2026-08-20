// ========================================================================
// 采集系统 - 配置补丁校验
// REST 接口与 AI 维护工具共用同一份约束，避免两边限制走偏。
// ========================================================================

import { z } from 'zod';

export const collectionSettingsPatchSchema = z.object({
  storage: z
    .object({
      mode: z.enum(['hotlink_only', 'r2_only', 'hybrid']).optional(),
      growthMode: z.enum(['slow', 'rapid']).optional(),
      latestDays: z.number().int().min(1).max(365).optional(),
      popularViewThreshold: z.number().int().min(0).optional(),
      maxStorageGB: z.number().min(1).optional(),
      monthlyBudgetUSD: z.number().min(0).optional(),
    })
    .optional(),
  dailySchedule: z
    .object({
      enabled: z.boolean().optional(),
      pageCountPerRun: z.number().int().min(1).max(200).optional(),
      incremental: z.boolean().optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    })
    .optional(),
  weeklySchedule: z
    .object({
      enabled: z.boolean().optional(),
      pageCountPerRun: z.number().int().min(1).max(500).optional(),
      incremental: z.boolean().optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    })
    .optional(),
  pool: z
    .object({
      minAccountCount: z.number().int().min(1).optional(),
      vipWeightMultiplier: z.number().int().min(1).max(20).optional(),
      healthCheckIntervalMinutes: z.number().int().min(5).optional(),
      autoRemoveFailedAfterAttempts: z.number().int().min(1).optional(),
    })
    .optional(),
});

export type CollectionSettingsPatch = z.infer<typeof collectionSettingsPatchSchema>;
