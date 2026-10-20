import { writeFileSync } from "node:fs";
import path from "node:path";

import { BRAND_THEMES } from "../packages/ui/src/lib/brand-themes.ts";

const palettes = BRAND_THEMES.map(
  (theme) => `:root[data-color-theme="${theme.name}"],
.theme-swatch[data-color-theme="${theme.name}"] {
  --theme-base: rgb(${theme.base.join(" ")});
  --theme-light: rgb(${theme.light.join(" ")});
  --theme-accent: rgb(${theme.accent.join(" ")});
  --theme-ink: ${theme.cssInk ?? theme.ink};
}`
);

const output = path.resolve(
  import.meta.dirname,
  "../packages/ui/src/brand-palettes.generated.css"
);
writeFileSync(
  output,
  `/* Generated from lib/brand-themes.ts. Run vp run generate:brand-palette-css. */\n${palettes.join("\n\n")}\n`
);
