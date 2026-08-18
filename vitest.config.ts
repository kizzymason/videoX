import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 兑换用例会打真实数据库并制造行锁争抢，串行跑避免互相干扰
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
