const ignoredSegments = new Set([".git", ".turbo", "build", "dist", "node_modules"]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".mts",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const forbiddenValues = [
  String.fromCodePoint(183),
  `&${"middot;"}`,
  `&#${"183;"}`,
  `&#${"xB7;"}`,
  `\\${"u00B7"}`,
  `\\${"xB7"}`,
];
const violations: string[] = [];

for await (const path of new Bun.Glob("**/*").scan({
  cwd: import.meta.dir + "/..",
  onlyFiles: true,
})) {
  if (
    path.split(/[\\/]/).some((segment) => ignoredSegments.has(segment)) ||
    !textExtensions.has(path.slice(path.lastIndexOf(".")))
  ) {
    continue;
  }

  const text = await Bun.file(new URL(`../${path}`, import.meta.url)).text();
  if (
    forbiddenValues.some((value) => text.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
  ) {
    violations.push(path);
  }
}

if (violations.length > 0) {
  console.error(`Middle-dot separators are not allowed:\n${violations.join("\n")}`);
  process.exit(1);
}

console.log("No middle-dot separators found.");
