import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { wgslVitePlugin } from "vgpu/client";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
    },
    resolve: {
      conditions: ["development"],
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        output: {
          entryFileNames: "index.cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    define: {
      __QUIETER_BUILD_ID__: JSON.stringify("desktop"),
    },
    plugins: [wgslVitePlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        "#": fileURLToPath(new URL("src/renderer", import.meta.url)),
      },
      dedupe: [
        "@tanstack/react-router",
        "@tiptap/core",
        "@tiptap/pm",
        "@tiptap/react",
        "motion",
        "react",
        "react-dom",
      ],
    },
    root: fileURLToPath(new URL("src/renderer", import.meta.url)),
    server: {
      host: "127.0.0.1",
      port: 5178,
      strictPort: true,
    },
  },
});
