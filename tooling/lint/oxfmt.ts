import type { OxfmtConfig } from "vite-plus/fmt";

import { ignorePatterns } from "./ignores";

export default {
  arrowParens: "always",
  bracketSameLine: false,
  bracketSpacing: true,
  endOfLine: "lf",
  ignorePatterns,
  jsxSingleQuote: false,
  printWidth: 80,
  proseWrap: "never",
  quoteProps: "as-needed",
  semi: true,
  singleQuote: false,
  sortImports: {
    ignoreCase: true,
    newlinesBetween: true,
    order: "asc",
  },
  sortPackageJson: true,
  tabWidth: 2,
  trailingComma: "es5",
  useTabs: false,
} satisfies OxfmtConfig;
