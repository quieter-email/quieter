export default {
  resolve: { conditions: ["development"] },
  test: {
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    hookTimeout: 20_000,
    include: ["packages/orpc/tests/native/collaboration.fixture.ts"],
    maxWorkers: 1,
    testTimeout: 20_000,
  },
};
