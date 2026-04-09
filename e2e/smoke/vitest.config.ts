import { defineConfig } from "vitest/config";

import { smokeVitestTestConfig } from "./vitest.shared";

export default defineConfig({
  test: {
    ...smokeVitestTestConfig,
    include: ["smoke/**/*.test.ts"],
  },
});
