#!/usr/bin/env node
import { runManagementCli } from "./index";

process.exitCode = await runManagementCli({
  args: process.argv.slice(2),
  async readStdin() {
    process.stdin.setEncoding("utf-8");
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    return input;
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  stdout: (text) => {
    process.stdout.write(text);
  },
});
