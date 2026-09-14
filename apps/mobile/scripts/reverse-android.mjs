import { execFileSync } from "node:child_process";

const write = (line) => process.stdout.write(`[mobile] ${line}\n`);

const main = () => {
  try {
    const devices = execFileSync("adb", ["devices"], { encoding: "utf-8" })
      .split("\n")
      .slice(1)
      .filter((line) => line.includes("\tdevice"));

    if (devices.length === 0) {
      write("no running adb device; skipping port reverse");
      return;
    }

    execFileSync("adb", ["reverse", "tcp:3000", "tcp:3000"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    write("adb reverse tcp:3000 -> host:3000");
  } catch {
    write("adb unavailable; skipping port reverse");
  }
};

main();
