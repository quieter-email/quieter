import { spawn } from "node:child_process";

import { createDesktopEnv } from "@quieter/env/desktop";

const env = createDesktopEnv({
  ...process.env,
  DESKTOP_MAIL_UPDATES_URL:
    process.env.DESKTOP_MAIL_UPDATES_URL ?? "ws://127.0.0.1:8787/mail/live",
  DESKTOP_SERVER_URL: process.env.DESKTOP_SERVER_URL ?? "http://localhost:3000",
});

const child = spawn("vp", ["run", "@quieter/desktop#dev"], {
  env: {
    ...process.env,
    DESKTOP_MAIL_UPDATES_URL: env.DESKTOP_MAIL_UPDATES_URL,
    DESKTOP_SERVER_URL: env.DESKTOP_SERVER_URL,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
