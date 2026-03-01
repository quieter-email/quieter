import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");

  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return {
    server: {
      port: 3000,
    },
    plugins: [tsConfigPaths({ projects: ["./tsconfig.json"] }), tailwindcss(), solidStart()],
    envDir: "../../",
  };
});
