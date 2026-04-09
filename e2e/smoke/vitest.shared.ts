export const smokeVitestTestConfig = {
  fileParallelism: false,
  hookTimeout: 180_000,
  maxWorkers: 1,
  minWorkers: 1,
  sequence: { concurrent: false },
  testTimeout: 600_000,
} as const;
