import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  server: { middlewareMode: true },
});
try {
  await server.ssrLoadModule("/scripts/benchmark-mail-ai.ts");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Mail AI benchmark failed."}\n`
  );
  process.exitCode = 1;
} finally {
  await server.close();
}
