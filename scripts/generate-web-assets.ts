import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { brand } from "../packages/ui/src/lib/brand-geometry.ts";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "logo");
const publicDir = path.join(root, "apps/web/public");
const scratch = path.join(root, ".scratch/brand-render");
const renderer = path.join(
  root,
  "node_modules/@resvg/resvg-js-cli/bin/resvg-js-cli.mjs"
);
for (const directory of [
  output,
  publicDir,
  scratch,
  path.join(output, "core"),
]) {
  mkdirSync(directory, { recursive: true });
}

type Artwork = "mark" | "wordmark" | "combination";
type Color = readonly [number, number, number];
type Treatment = {
  name: string;
  label: string;
  mode: "solid" | "fold" | "mist" | "metal" | "caustic" | "halo";
  base: Color;
  light: Color;
  accent: Color;
  ink: string;
  phase: number;
};

const treatments: Treatment[] = [
  {
    accent: [14, 15, 16],
    base: [14, 15, 16],
    ink: brand.light,
    label: "Obsidian",
    light: [14, 15, 16],
    mode: "solid",
    name: "01-obsidian",
    phase: 0,
  },
  {
    accent: [238, 238, 240],
    base: [238, 238, 240],
    ink: brand.dark,
    label: "Paper",
    light: [238, 238, 240],
    mode: "solid",
    name: "02-paper",
    phase: 0,
  },
  {
    accent: [29, 55, 97],
    base: [9, 12, 17],
    ink: brand.light,
    label: "Atmosphere",
    light: [128, 146, 164],
    mode: "fold",
    name: "03-atmosphere",
    phase: 0.8,
  },
  {
    accent: [154, 169, 186],
    base: [230, 231, 233],
    ink: brand.dark,
    label: "Porcelain",
    light: [254, 254, 252],
    mode: "mist",
    name: "04-porcelain",
    phase: 1.2,
  },
  {
    accent: [18, 53, 132],
    base: [5, 13, 35],
    ink: brand.light,
    label: "Blue hour",
    light: [85, 148, 218],
    mode: "fold",
    name: "05-blue-hour",
    phase: 2.8,
  },
  {
    accent: [26, 72, 107],
    base: [5, 19, 22],
    ink: brand.light,
    label: "Aurora",
    light: [108, 192, 167],
    mode: "fold",
    name: "06-aurora",
    phase: 4.2,
  },
  {
    accent: [97, 35, 31],
    base: [22, 11, 12],
    ink: brand.light,
    label: "Ember",
    light: [193, 130, 96],
    mode: "fold",
    name: "07-ember",
    phase: 1.9,
  },
  {
    accent: [160, 149, 187],
    base: [224, 222, 233],
    ink: brand.dark,
    label: "Lilac haze",
    light: [254, 246, 240],
    mode: "mist",
    name: "08-lilac",
    phase: 3.6,
  },
  {
    accent: [40, 49, 62],
    base: [12, 15, 19],
    ink: "url(#metal)",
    label: "Silver",
    light: [131, 141, 151],
    mode: "metal",
    name: "09-silver",
    phase: 1.7,
  },
  {
    accent: [177, 153, 130],
    base: [229, 222, 210],
    ink: "#28231f",
    label: "Sand",
    light: [253, 248, 236],
    mode: "mist",
    name: "10-sand",
    phase: 5.1,
  },
  {
    accent: [21, 54, 74],
    base: [6, 18, 30],
    ink: brand.light,
    label: "Caustic",
    light: [108, 182, 207],
    mode: "caustic",
    name: "11-caustic",
    phase: 2.3,
  },
  {
    accent: [40, 45, 68],
    base: [10, 11, 14],
    ink: brand.light,
    label: "Eclipse",
    light: [155, 164, 190],
    mode: "halo",
    name: "12-eclipse",
    phase: 0,
  },
];
const formats = [
  { height: 1024, name: "profile", width: 1024 },
  { height: 630, name: "og", width: 1200 },
  { height: 800, name: "banner", width: 2400 },
];
const variants: Artwork[] = ["mark", "combination", "wordmark"];
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    // oxlint-disable-next-line eslint/no-bitwise -- PNG CRC32 operates on individual bits.
    value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value;
}
const pngChunk = (kind: string, data: Buffer) => {
  const contents = Buffer.concat([Buffer.from(kind), data]);
  let crc = 0xff_ff_ff_ff;
  for (const byte of contents) {
    // oxlint-disable-next-line eslint/no-bitwise -- PNG CRC32 operates on individual bits.
    crc = (crcTable[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  }
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  contents.copy(chunk, 4);
  // oxlint-disable-next-line eslint/no-bitwise -- Final unsigned PNG CRC32 checksum.
  chunk.writeUInt32BE((crc ^ 0xff_ff_ff_ff) >>> 0, chunk.length - 4);
  return chunk;
};

// Still frames of curved light fields, with spatial grain and a quiet center for the artwork.
const shader = (width: number, height: number, treatment: Treatment) => {
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x / width - 0.5) * 2;
      const v = (y / height - 0.5) * 2;
      const { phase, mode } = treatment;
      const curve = v + 0.24 * u - 0.38 * Math.sin(u * 2 + phase) - 0.18;
      const fold = Math.exp(-(curve * curve) / 0.018);
      const broad = Math.exp(-(curve * curve) / 0.2);
      const glow = Math.exp(-((u + 0.75) ** 2 / 0.8 + (v - 0.5) ** 2 / 0.65));
      const quiet = 1 - 0.76 * Math.exp(-((u * u) / 0.42 + (v * v) / 0.22));
      let highlight = 0;
      let tint = 0;
      if (mode === "fold") {
        highlight = (fold * 0.58 + broad * 0.18) * quiet;
        tint = glow * 0.62;
      } else if (mode === "mist") {
        highlight = Math.exp(-((u - 0.3) ** 2 + (v + 0.55) ** 2) / 0.85) * 0.9;
        tint = (broad * 0.36 + glow * 0.23) * quiet;
      } else if (mode === "metal") {
        const stripe = v + 0.54 * u + 0.17 * Math.sin(u * 3 + phase);
        highlight = Math.exp(-((stripe - 0.47) ** 2) / 0.032) * 0.68 * quiet;
        tint = broad * 0.3;
      } else if (mode === "caustic") {
        const second = v - 0.43 * Math.sin(u * 2.7 + phase) + 0.3;
        highlight =
          (Math.exp(-(curve * curve) / 0.003) +
            Math.exp(-(second * second) / 0.005)) *
          0.4 *
          quiet;
        tint = (broad + glow) * 0.24;
      } else if (mode === "halo") {
        const distance = Math.hypot(u * (width / height), v + 0.07);
        highlight = Math.exp(-((distance - 0.7) ** 2) / 0.008) * 0.56;
        tint = Math.exp(-((distance - 0.72) ** 2) / 0.065) * 0.65;
      }
      const random = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
      const grain =
        mode === "solid" ? 0 : (random - Math.floor(random) - 0.5) * 2.4;
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = treatment.base[channel] ?? 0;
        const color = base + ((treatment.accent[channel] ?? 0) - base) * tint;
        scanlines[offset + channel] = Math.round(
          Math.max(
            0,
            Math.min(
              255,
              color +
                ((treatment.light[channel] ?? 0) - color) * highlight +
                grain
            )
          )
        );
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};
const artwork = (
  variant: Artwork,
  width: number,
  height: number,
  ink: string,
  coverage = 0.7
) => {
  const geometry = brand[variant];
  const scale = Math.min(
    (width * coverage) / geometry.width,
    (height * (variant === "mark" ? 0.8 : 0.52)) / geometry.height
  );
  return `<path fill="${ink}" d="${geometry.path}" transform="translate(${(width - geometry.width * scale) / 2} ${(height - geometry.height * scale) / 2}) scale(${scale})"/>`;
};
const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Quieter</title>${body}</svg>`;
const render = (
  source: string,
  destination: string,
  width: number,
  height: number
) => {
  const input = path.join(scratch, "render.svg");
  writeFileSync(input, source);
  const result = spawnSync(
    process.execPath,
    [
      renderer,
      ...(source.includes("<text") ? [] : ["--no-system-font"]),
      "--fit-width",
      String(width),
      "--fit-height",
      String(height),
      input,
      destination,
    ],
    { encoding: "utf-8" }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `SVG export failed for ${destination}: ${result.error?.message ?? result.stderr}`
    );
  }
};

for (const variant of variants) {
  for (const theme of ["dark", "light"] as const) {
    for (const transparent of [true, false]) {
      const width = variant === "mark" ? 2048 : 3000;
      const height = variant === "mark" ? 2048 : 900;
      const ink = theme === "dark" ? brand.dark : brand.light;
      const ground = theme === "dark" ? brand.light : brand.dark;
      const stem = `${variant}-${theme}${transparent ? "-transparent" : "-background"}`;
      const body = `${transparent ? "" : `<rect width="100%" height="100%" fill="${ground}"/>`}${artwork(variant, width, height, ink, variant === "mark" ? 1 : 0.88)}`;
      const source = svg(width, height, body);
      writeFileSync(path.join(output, "core", `${stem}.svg`), source);
      render(source, path.join(output, "core", `${stem}.png`), width, height);
    }
  }
}
for (const [name, source] of [
  ["logo", "mark-dark-transparent"],
  ["logo_light", "mark-light-transparent"],
  ["wordmark", "wordmark-light-background"],
  ["wordmark_light", "wordmark-dark-background"],
  ["combination", "combination-light-background"],
  ["combination_light", "combination-dark-background"],
]) {
  for (const extension of ["svg", "png"]) {
    copyFileSync(
      path.join(output, "core", `${source}.${extension}`),
      path.join(output, `${name}.${extension}`)
    );
  }
}

const gallery: {
  treatment: string;
  label: string;
  format: string;
  variant: Artwork;
  file: string;
  width: number;
  height: number;
}[] = [];
const thumbnails: string[] = [];
for (const treatment of treatments) {
  mkdirSync(path.join(output, treatment.name), { recursive: true });
  for (const format of formats) {
    const background = shader(format.width, format.height, treatment).toString(
      "base64"
    );
    for (const variant of variants) {
      const file = `${treatment.name}/${format.name}-${variant}.png`;
      const shadow =
        treatment.mode === "metal" || treatment.name === "04-porcelain";
      const body = `<defs><filter id="shadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#0e0f10" flood-opacity=".18"/></filter><linearGradient id="metal" x1="0" y1="0" x2="0.7" y2="1"><stop stop-color="#fff"/><stop offset=".45" stop-color="#e0e3e7"/><stop offset=".55" stop-color="#9ca4b0"/><stop offset="1" stop-color="#eef1f4"/></linearGradient></defs><image width="${format.width}" height="${format.height}" href="data:image/png;base64,${background}"/><g${shadow ? ' filter="url(#shadow)"' : ""}>${artwork(variant, format.width, format.height, treatment.ink, variant === "mark" ? 0.66 : 0.71)}</g>`;
      const source = svg(format.width, format.height, body);
      render(source, path.join(output, file), format.width, format.height);
      gallery.push({
        file,
        format: format.name,
        height: format.height,
        label: treatment.label,
        treatment: treatment.name,
        variant,
        width: format.width,
      });
      if (format.name === "og" && variant === "combination") {
        const thumb = path.join(scratch, `${treatment.name}.png`);
        render(source, thumb, 600, 315);
        thumbnails.push(readFileSync(thumb).toString("base64"));
      }
    }
  }
  process.stdout.write(`Rendered ${treatment.label}\n`);
}
let sheet = '<rect width="100%" height="100%" fill="#18191b"/>';
for (const [index, treatment] of treatments.entries()) {
  const x = 30 + (index % 3) * 620;
  const y = 30 + Math.floor(index / 3) * 370;
  sheet += `<image x="${x}" y="${y}" width="600" height="315" href="data:image/png;base64,${thumbnails[index]}"/><text x="${x + 4}" y="${y + 345}" fill="#eeeef0" font-family="Arial" font-size="20">${treatment.name.slice(0, 2)} / ${treatment.label}</text>`;
}
render(
  svg(1890, 1500, sheet),
  path.join(output, "contact-sheet.png"),
  1890,
  1500
);
writeFileSync(
  path.join(output, "manifest.json"),
  `${JSON.stringify({ assets: gallery, colors: { dark: brand.dark, light: brand.light } }, null, 2)}\n`
);
const sections = treatments
  .map(
    (treatment) =>
      `<section><h2>${treatment.name.slice(0, 2)} / ${treatment.label}</h2><div class="grid">${gallery
        .filter((item) => item.treatment === treatment.name)
        .map(
          (item) =>
            `<a href="${item.file}" download><img loading="lazy" src="${item.file}" alt="${item.label}, ${item.variant}, ${item.format}"><span>${item.format} / ${item.variant}<small>${item.width} × ${item.height}</small></span></a>`
        )
        .join("")}</div></section>`
  )
  .join("");
writeFileSync(
  path.join(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quieter brand assets</title><style>body{margin:0;background:#0e0f10;color:#eeeef0;font:15px system-ui}main{max-width:1440px;margin:auto;padding:48px 32px}h1{font-size:32px;font-weight:500}p{color:#929599;line-height:1.7}h2{font-size:19px;font-weight:450;margin-top:56px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}a{color:inherit;text-decoration:none}img{display:block;width:100%;aspect-ratio:1.9;object-fit:contain;background:#17181a}span{display:flex;justify-content:space-between;padding-top:12px}small{color:#8e9399}@media(max-width:750px){.grid{grid-template-columns:1fr}main{padding:24px}}</style><main><h1>Quieter</h1><p>Original 004. Custom Geist wordmark.<br>108 images, 12 treatments. Select an image to save the full-size PNG.<br>SVG and transparent PNG masters are in the core folder. Dark and light in core filenames describe the ink color.</p>${sections}</main></html>`
);

const icon = (ground: string, ink: string, coverage: number) =>
  svg(
    1000,
    1000,
    `<rect width="1000" height="1000" fill="${ground}"/><path fill="${ink}" d="${brand.mark.path}" transform="translate(${500 * (1 - coverage)} ${500 * (1 - coverage)}) scale(${coverage})"/>`
  );
for (const [filename, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
] as const) {
  render(
    icon(brand.dark, brand.light, 0.9),
    path.join(publicDir, filename),
    size,
    size
  );
}
for (const [suffix, ground, ink] of [
  ["", brand.dark, brand.light],
  ["-dev", "#34231a", "#f2d6bd"],
] as const) {
  const source = icon(ground, ink, 1.05);
  writeFileSync(path.join(publicDir, `icon${suffix}.svg`), source);
  const sizes = [16, 32, 48, 64];
  const images = sizes.map((size) => {
    const destination = path.join(scratch, `favicon-${size}.png`);
    render(source, destination, size, size);
    return readFileSync(destination);
  });
  const headerSize = 6 + sizes.length * 16;
  const ico = Buffer.alloc(
    headerSize + images.reduce((sum, image) => sum + image.length, 0)
  );
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(images.length, 4);
  let offset = headerSize;
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    ico[entry] = sizes[index] ?? 0;
    ico[entry + 1] = sizes[index] ?? 0;
    ico.writeUInt16LE(1, entry + 4);
    ico.writeUInt16LE(32, entry + 6);
    ico.writeUInt32LE(image.length, entry + 8);
    ico.writeUInt32LE(offset, entry + 12);
    image.copy(ico, offset);
    offset += image.length;
  }
  writeFileSync(path.join(publicDir, `favicon${suffix}.ico`), ico);
}
writeFileSync(
  path.join(publicDir, "safari-pinned-tab.svg"),
  svg(1000, 1000, artwork("mark", 1000, 1000, "#000", 1))
);
for (const [file, source] of [
  ["logo.svg", "mark-dark-transparent"],
  ["logo-light.svg", "mark-light-transparent"],
  ["wordmark.svg", "wordmark-dark-transparent"],
  ["wordmark-light.svg", "wordmark-light-transparent"],
  ["combination.svg", "combination-dark-transparent"],
  ["combination-light.svg", "combination-light-transparent"],
]) {
  copyFileSync(
    path.join(output, "core", `${source}.svg`),
    path.join(publicDir, file)
  );
}
copyFileSync(
  path.join(output, "03-atmosphere/og-combination.png"),
  path.join(publicDir, "og-image.png")
);
const manifestPath = path.join(publicDir, "site.webmanifest");
const manifestText = readFileSync(manifestPath, "utf-8")
  .replace(
    /"background_color":\s*"[^"]*"/u,
    `"background_color": "${brand.dark}"`
  )
  .replace(/"theme_color":\s*"[^"]*"/u, `"theme_color": "${brand.dark}"`);
writeFileSync(manifestPath, manifestText);
process.stdout.write(
  `Exported ${gallery.length} social images, vector masters, app icons, favicons and OG image.\n`
);
