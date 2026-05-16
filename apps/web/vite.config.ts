import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    nitro({ preset: "vercel" }),
  ],
  resolve: {
    dedupe: ["@tanstack/react-router", "react", "react-dom"],
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
  },
});
