module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  // Per HEL-80: AUTOFLOW_ALLOW_INMEMORY=true is required to use the
  // in-memory store fallback (postgres.ts:inMemoryAllowed). Tests opt in
  // automatically; production must never set this variable.
  setupFiles: ["<rootDir>/jest.env.cjs"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dashboard/",
    "/\\.claude/worktrees/",
    "/\\.worktrees/",
    "/paperclipai-alt\\d+/",
  ],
  modulePathIgnorePatterns: [
    "<rootDir>/\\.claude/worktrees/",
    "<rootDir>/\\.worktrees/",
    "<rootDir>/paperclipai-alt\\d+/",
  ],
  collectCoverageFrom: [
    "src/app.ts",
    "src/auth/**/*.ts",
    "src/billing/**/*.ts",
    "src/engine/**/*.ts",
    "src/llmConfig/**/*.ts",
    "src/mcp/**/*.ts",
    "src/memory/**/*.ts",
    "src/templates/**/*.ts",
    "!src/index.ts",
    "!src/test-factories/**",
    "!src/**/__mocks__/**",
  ],
  coverageThreshold: {
    global: {
      lines: 60,
      functions: 60,
      branches: 60,
      statements: 60,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  forceExit: true,
};
