import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  server: { middlewareMode: true },
});
try {
  await server.ssrLoadModule("/scripts/benchmark-mail-ai.ts");
} finally {
  await server.close();
}
