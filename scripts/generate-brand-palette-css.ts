import { writeFileSync } from "node:fs";
import path from "node:path";

import { APP_THEMES } from "../packages/ui/src/lib/brand-themes.ts";

const palettes = APP_THEMES.map(
  (theme) => `:root[data-color-theme="${theme.name}"],
.theme-swatch[data-color-theme="${theme.name}"] {
  --theme-base: rgb(${theme.base.join(" ")});
  --theme-accent: rgb(${theme.accent.join(" ")});
  --theme-ink: ${theme.ink};
  --theme-raised: rgb(${theme.palette.raised.join(" ")});
  --theme-surface: rgb(${theme.palette.surface.join(" ")});
  --theme-primary: ${theme.palette.primary};
  --theme-primary-fg: ${theme.palette.primaryInk};
  --theme-glow: ${theme.palette.glow ? "radial-gradient(ellipse at 6% 110%, color-mix(in srgb, var(--theme-accent) 28%, transparent), transparent 70%)" : "none"};
  --theme-panel-gradient: ${theme.palette.panelGradient === true ? "linear-gradient(180deg, var(--theme-surface), var(--theme-raised))" : "none"};
  --theme-radius: ${theme.palette.radius ?? 10}px;
  --theme-gutter: ${theme.palette.gutter?.[0] ?? 6}px;
  --theme-gutter-wide: ${theme.palette.gutter?.[1] ?? 8}px;
  --theme-row-padding: ${theme.palette.rowPadding ?? 12}px;
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
