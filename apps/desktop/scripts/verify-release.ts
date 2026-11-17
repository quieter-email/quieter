import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { sizeReportSchema } from "./release-report.ts";

const hashDistribution = ({
  filename,
  expectedBytes,
}: {
  filename: string;
  expectedBytes: number;
}) => {
  const expected = lstatSync(filename);
  if (
    !expected.isFile() ||
    expected.size === 0 ||
    expected.size !== expectedBytes
  ) {
    throw new Error(
      "Every recorded distribution must be a nonempty regular file."
    );
  }
  const descriptor = openSync(
    filename,
    process.platform === "win32" ? "r" : constants.O_NOFOLLOW
  );
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  let bytes = 0;
  try {
    const before = fstatSync(descriptor);
    if (
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      !before.isFile()
    ) {
      throw new Error("A recorded distribution changed while it was opened.");
    }
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (count === 0) {
        break;
      }
      bytes += count;
      if (bytes > expectedBytes) {
        throw new Error("A recorded distribution grew while it was hashed.");
      }
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error("A recorded distribution changed while it was hashed.");
    }
  } finally {
    closeSync(descriptor);
  }
  return { bytes, sha256: hash.digest("hex") };
};

const main = (): void => {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      report: { type: "string" },
      revision: { type: "string" },
    },
  });
  if (values.help === true) {
    process.stdout.write(
      "Usage: vp run @quieter/desktop#release:verify --revision <full-SHA> [--report <release-size.json>]\n"
    );
    return;
  }
  const reportPath = path.resolve(
    values.report ??
      path.join(import.meta.dirname, "../release/release-size.json")
  );
  const directory = path.dirname(reportPath);
  if (/[\r\n]/u.test(reportPath) || !lstatSync(directory).isDirectory()) {
    throw new Error(
      "The report must be inside a real directory without newlines."
    );
  }
  const root = realpathSync(directory);
  const receiptPath = path.join(root, "release-integrity.json");
  if (
    path.basename(reportPath).normalize("NFC").toLowerCase() ===
    "release-integrity.json"
  ) {
    throw new Error(
      "The size report cannot use the integrity receipt filename."
    );
  }
  rmSync(receiptPath, { force: true });
  const expectedRevision = sizeReportSchema.shape.sourceRevision.parse(
    values.revision
  );
  const repository = path.resolve(import.meta.dirname, "../../..");
  const verifierRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf-8",
  }).trim();
  if (verifierRevision !== expectedRevision) {
    throw new Error("The expected source SHA does not match this checkout.");
  }
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: repository,
      encoding: "utf-8",
    }).trim() !== ""
  ) {
    throw new Error(
      "Distribution verification requires a clean source checkout."
    );
  }
  const reportStat = lstatSync(reportPath);
  if (
    !reportStat.isFile() ||
    reportStat.size === 0 ||
    reportStat.size > 1024 * 1024
  ) {
    throw new Error(
      "The size report must be a nonempty regular file of at most one MiB."
    );
  }
  const descriptor = openSync(
    reportPath,
    process.platform === "win32" ? "r" : constants.O_NOFOLLOW
  );
  const buffer = Buffer.alloc(1024 * 1024 + 1);
  let reportBytes = 0;
  try {
    for (;;) {
      const count = readSync(
        descriptor,
        buffer,
        reportBytes,
        buffer.byteLength - reportBytes,
        null
      );
      if (count === 0) {
        break;
      }
      reportBytes += count;
      if (reportBytes === buffer.byteLength) {
        throw new Error("The size report exceeds one MiB.");
      }
    }
  } finally {
    closeSync(descriptor);
  }
  const rawReport = buffer.subarray(0, reportBytes);
  const raw: unknown = JSON.parse(rawReport.toString("utf-8"));
  const report = sizeReportSchema.parse(raw);
  if (report.sourceDirty || report.sourceRevision !== expectedRevision) {
    throw new Error("The size report must record this clean source revision.");
  }
  const seen = new Set<string>();
  let distributions = 0;
  let unpacked = 0;
  for (const entry of report.entries) {
    const portablePath = entry.path.normalize("NFC").toLowerCase();
    if (seen.has(portablePath)) {
      throw new Error("The size report contains duplicate artifact paths.");
    }
    seen.add(portablePath);
    if (entry.kind === "unpacked-app") {
      unpacked += 1;
      continue;
    }
    let filename = root;
    const parts = entry.path.split("/");
    for (const [index, part] of parts.entries()) {
      filename = path.join(filename, part);
      const stat = lstatSync(filename);
      if (
        stat.isSymbolicLink() ||
        (index < parts.length - 1 && !stat.isDirectory())
      ) {
        throw new Error(
          "A distribution path contains a symbolic link or non-directory parent."
        );
      }
    }
    if (realpathSync(filename) !== filename) {
      throw new Error("A recorded distribution escaped the report directory.");
    }
    const actual = hashDistribution({ expectedBytes: entry.bytes, filename });
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) {
      throw new Error(
        "A recorded distribution does not match its size report."
      );
    }
    if (realpathSync(filename) !== filename) {
      throw new Error("A distribution path changed while it was verified.");
    }
    distributions += 1;
  }
  if (distributions === 0 || unpacked === 0) {
    throw new Error(
      "The size report must contain distribution and unpacked application entries."
    );
  }
  const receipt = {
    checkedDistributions: distributions,
    kind: "distribution-integrity-checked",
    notVerified: ["signatures", "installation", "updates", "unpacked-content"],
    schemaVersion: 1,
    sizeReportSha256: createHash("sha256").update(rawReport).digest("hex"),
    verifierRevision,
  };
  const temporaryReceipt = path.join(
    root,
    `release-integrity-${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(temporaryReceipt, receiptPath);
  } finally {
    rmSync(temporaryReceipt, { force: true });
  }
  process.stdout.write(`${receiptPath}\n`);
};

main();
