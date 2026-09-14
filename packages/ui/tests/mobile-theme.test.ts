/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vite-plus/test";

const readCss = async (relativePath: string) =>
  await readFile(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf-8"
  );

const stripComments = (css: string) => {
  const parts: string[] = [];
  let depth = 0;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    const next = css[index + 1];
    if (character === "/" && next === "*") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === "*" && next === "/" && depth > 0) {
      depth -= 1;
      index += 1;
      continue;
    }
    if (depth === 0 && character !== undefined) {
      parts.push(character);
    }
  }
  return parts.join("");
};

const collectBlock = (
  css: string,
  startLine: string,
  endLine: string
): string => {
  const lines = css.split("\n");
  const start = lines.findIndex((line) => line.trim() === startLine);
  if (start === -1) {
    throw new Error(`Missing block start: ${startLine}`);
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() === endLine
  );
  if (end === -1) {
    throw new Error(`Missing block end for: ${startLine}`);
  }
  return lines.slice(start + 1, end).join("\n");
};

const parseDeclarations = (block: string) => {
  const declarations = new Map<string, string>();
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("--")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .replace(";", "")
      .trim();
    declarations.set(
      name,
      value
        .split(/\s+/u)
        .filter((part) => part.length > 0)
        .join(" ")
    );
  }
  return declarations;
};

const resolveVariables = (declarations: Map<string, string>) => {
  const resolved = new Map(declarations);
  const resolve = (value: string, depth = 0): string => {
    if (depth > 8) {
      throw new Error(`Unresolvable variable chain: ${value}`);
    }
    if (!value.startsWith("var(")) {
      return value;
    }
    const name = value.slice(4, -1);
    const target = resolved.get(name);
    if (target === undefined) {
      throw new Error(`Unknown variable ${name}`);
    }
    return resolve(target, depth + 1);
  };
  for (const [name, value] of resolved) {
    resolved.set(name, resolve(value));
  }
  return resolved;
};

describe("mobile theme parity", () => {
  test("mirrors every shared color token in both themes", async () => {
    const [webCss, mobileCss] = await Promise.all([
      readCss("../src/styles.css"),
      readCss("../src/mobile-theme.css"),
    ]);

    const webLight = resolveVariables(
      parseDeclarations(collectBlock(stripComments(webCss), ":root,", "}"))
    );
    const webDark = resolveVariables(
      parseDeclarations(collectBlock(stripComments(webCss), ".dark,", "}"))
    );
    const mobileLight = parseDeclarations(
      collectBlock(stripComments(mobileCss), "@variant light {", "}")
    );
    const mobileDark = parseDeclarations(
      collectBlock(stripComments(mobileCss), "@variant dark {", "}")
    );

    expect(mobileLight.size).toBeGreaterThan(0);
    expect(mobileLight.size).toBe(mobileDark.size);

    for (const [name, value] of mobileLight) {
      const token = name.replace("--color-", "--");
      expect(webLight.get(token), `${token} missing from web light`).toBe(
        value
      );
    }
    for (const [name, value] of mobileDark) {
      const token = name.replace("--color-", "--");
      expect(webDark.get(token), `${token} missing from web dark`).toBe(value);
    }
  });
});
