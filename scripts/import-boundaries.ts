import path from "node:path";

import { parseSync, Visitor } from "oxc-parser";

const awsOrpcEntrypoints = new Set([
  "@quieter/orpc/managed-mail/ingestion",
  "@quieter/orpc/organization-mail-delivery",
]);
const databasePackages = ["@quieter/database", "drizzle-orm", "postgres"];
const appProviderPackages = [
  "@quieter/gmail",
  "@base-ui/react",
  "@base-ui-components/react",
  "vaul",
];

export const findImportBoundaryViolations = (
  filename: string,
  source: string,
  applicationPackages: ReadonlySet<string>
): string[] => {
  const file = filename.replaceAll("\\", "/");
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) {
    return parsed.errors.map((error) => `${file}: ${error.message}`);
  }
  const violations: string[] = [];
  const check = (specifier: string, start: number, bindings: string[] = []) => {
    const target = specifier.startsWith(".")
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier)
        )
      : specifier;
    let reason: string | undefined;
    if (
      file.startsWith("packages/") &&
      (target.startsWith("apps/") ||
        specifier.startsWith("#/") ||
        [...applicationPackages].some(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        ))
    ) {
      reason = "Packages must not depend on application code.";
    }
    if (file.startsWith("apps/")) {
      const databaseImport =
        target.startsWith("packages/database/") ||
        databasePackages.some(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        );
      const requestBootstrap =
        file === "apps/web/src/start.ts" &&
        specifier === "@quieter/database/client" &&
        bindings.length === 1 &&
        bindings[0] === "withRequestDatabaseClient";
      if (databaseImport && !requestBootstrap) {
        reason = "Application code must access data through @quieter/orpc.";
      }
      if (
        target.startsWith("packages/gmail/") ||
        appProviderPackages.some(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        )
      ) {
        reason =
          "Use shared mail contracts and @quieter/ui components in applications.";
      }
    }
    if (
      file.startsWith("packages/aws/src/") &&
      (specifier === "@quieter/orpc" ||
        specifier.startsWith("@quieter/orpc/") ||
        target.startsWith("packages/orpc/")) &&
      !awsOrpcEntrypoints.has(specifier)
    ) {
      reason = "AWS handlers must use deployment-safe oRPC entrypoints.";
    }
    if (reason !== undefined) {
      const line = source.slice(0, start).split("\n").length;
      violations.push(`${file}:${line}: ${specifier}: ${reason}`);
    }
  };
  new Visitor({
    CallExpression(node) {
      const [argument] = node.arguments;
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        argument?.type === "Literal" &&
        typeof argument.value === "string"
      ) {
        check(argument.value, node.start);
      }
    },
    ExportAllDeclaration(node) {
      check(node.source.value, node.start);
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) {
        check(node.source.value, node.start);
      }
    },
    ImportDeclaration(node) {
      check(
        node.source.value,
        node.start,
        node.specifiers.map((specifier) => {
          if (specifier.type !== "ImportSpecifier") {
            return "*";
          }
          return specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
        })
      );
    },
    ImportExpression(node) {
      if (
        node.source.type === "Literal" &&
        typeof node.source.value === "string"
      ) {
        check(node.source.value, node.start);
      } else {
        violations.push(
          `${file}: Dynamic imports must use a literal module name so package boundaries can be checked.`
        );
      }
    },
    TSImportType(node) {
      check(node.source.value, node.start);
    },
  }).visit(parsed.program);
  return violations;
};
