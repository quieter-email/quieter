import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    endOfLine: "lf",
    tabWidth: 2,
    experimentalSortImports: {
      newlinesBetween: false,
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        "type-internal",
        "value-internal",
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    experimentalTailwindcss: {
      stylesheet: "packages/ui/src/styles.css",
      functions: ["clsx", "cn", "twMerge"],
    },
    ignorePatterns: [
      ".agents/**",
      ".scratch/**",
      "routeTree.gen.ts",
      "**/.next/**",
      "**/.vercel/**",
      "**/.sst/**",
      "sst-env.d.ts",
      "packages/database/drizzle/**/snapshot.json",
    ],
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "react-perf"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "eslint-plugin-better-tailwindcss",
    ],
    settings: {
      "better-tailwindcss": {
        cwd: "apps/web",
        entryPoint: "../../packages/ui/src/styles.css",
        messageStyle: "compact",
        rootFontSize: 16,
      },
    },
    rules: {
      "better-tailwindcss/enforce-canonical-classes": "warn",
      "better-tailwindcss/no-deprecated-classes": "warn",
      "better-tailwindcss/no-duplicate-classes": "warn",
      "better-tailwindcss/no-unnecessary-whitespace": "warn",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      reportUnusedDisableDirectives: "warn",
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: [
      ".agents/**",
      ".scratch/**",
      "scripts/**",
      "**/.next/**",
      "**/.vercel/**",
      "**/.sst/**",
      "sst-env.d.ts",
      "routeTree.gen.ts",
      "sst.config.ts",
      "packages/database/drizzle/**/snapshot.json",
    ],
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  staged: {
    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,json,jsonc}": (files) => {
      const formatFiles = files.filter(
        (file) =>
          !/[\\/]packages[\\/]database[\\/]drizzle[\\/][^\\/]+[\\/]snapshot\.json$/.test(file),
      );
      return formatFiles.length > 0
        ? `vp fmt --write ${formatFiles.map((file) => JSON.stringify(file)).join(" ")}`
        : [];
    },
    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}": "vp lint --fix",
  },
  test: {
    exclude: [...configDefaults.exclude, ".scratch/**"],
  },
});
