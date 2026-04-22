module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dashboard/",
    "/\\.worktrees/",
    "/paperclipai-alt\\d+/",
  ],
  modulePathIgnorePatterns: [
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
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 64,
      statements: 80,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  forceExit: true,
};
