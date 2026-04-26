import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const projectRoot = resolve(import.meta.dir, "..");
const webPublicDir = resolve(projectRoot, "apps/web/public");
const tempDir = resolve(webPublicDir, ".asset-tmp");

const brand = {
  dark: "#1a1a1a",
  light: "#f2f2f2",
  page: "#f7f4ee",
  themeDark: "#141414",
  themeLight: "#f7f4ee",
};

type PdfShape =
  | {
      color: string;
      height: number;
      kind: "rect";
      opacity: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      color: string;
      d: string;
      kind: "path";
      opacity: number;
      transform: string;
    };

const args = Bun.argv.slice(2);
const inputArg = args.find((arg) => !arg.startsWith("--"));

if (!inputArg) {
  console.error("Usage: bun scripts/generate-web-assets.ts <path-to-logo.svg|logo.ai>");
  process.exit(1);
}

const sourcePath = isAbsolute(inputArg) ? inputArg : resolve(projectRoot, inputArg);
const sourceName = basename(sourcePath);
const sourceExt = extname(sourcePath).toLowerCase();
const lightPath = findLightVariant(sourcePath);
const combinationPath = findCombinationVariant(sourcePath);

await mkdir(webPublicDir, { recursive: true });
await mkdir(tempDir, { recursive: true });

const logo = await loadLogoSvg(sourcePath, sourceExt);
const lightLogo = lightPath ? await loadLogoSvg(lightPath, extname(lightPath).toLowerCase()) : null;
const ogLogo = combinationPath
  ? await loadLogoSvg(combinationPath, extname(combinationPath).toLowerCase())
  : logo;

await writeFile(
  resolve(webPublicDir, "icon.svg"),
  lightLogo ? buildSchemeIconSvg({ dark: logo, light: lightLogo }) : buildStaticIconSvg(logo, 1000),
);
await writeFile(resolve(webPublicDir, "safari-pinned-tab.svg"), buildPinnedTabSvg(logo));
await writeFile(resolve(webPublicDir, "site.webmanifest"), JSON.stringify(buildManifest(), null, 2) + "\n");

const renderJobs = [
  { file: "apple-touch-icon.png", size: 180, svg: buildStaticIconSvg(logo, 1000) },
  { file: "icon-192.png", size: 192, svg: buildStaticIconSvg(logo, 1000) },
  { file: "icon-512.png", size: 512, svg: buildStaticIconSvg(logo, 1000) },
  { file: "icon-maskable-512.png", size: 512, svg: buildMaskableIconSvg(logo) },
  { file: "og-image.png", size: 1200, svg: buildOgImageSvg(ogLogo), height: 630 },
];

for (const job of renderJobs) {
  const svgPath = resolve(tempDir, `${job.file}.svg`);
  const outputPath = resolve(webPublicDir, job.file);
  await writeFile(svgPath, job.svg);
  renderSvg(svgPath, outputPath, job.size, job.height ?? job.size);
}

const favicon16 = resolve(tempDir, "favicon-16.png");
const favicon32 = resolve(tempDir, "favicon-32.png");
const faviconSvg = resolve(tempDir, "favicon.svg");
await writeFile(faviconSvg, buildStaticIconSvg(logo, 1000));
renderSvg(faviconSvg, favicon16, 16, 16);
renderSvg(faviconSvg, favicon32, 32, 32);
await writeFile(
  resolve(webPublicDir, "favicon.ico"),
  buildIco([await readFile(favicon16), await readFile(favicon32)], [16, 32]),
);

await rm(tempDir, { force: true, recursive: true });

console.log(`Generated web assets from ${sourceName}:`);
console.log(`  source: ${sourcePath}`);

if (lightPath) {
  console.log(`  light variant: ${lightPath}`);
}

if (combinationPath) {
  console.log(`  og source: ${combinationPath}`);
}

console.log("  apps/web/public/favicon.ico");
console.log("  apps/web/public/icon.svg");
console.log("  apps/web/public/apple-touch-icon.png");
console.log("  apps/web/public/icon-192.png");
console.log("  apps/web/public/icon-512.png");
console.log("  apps/web/public/icon-maskable-512.png");
console.log("  apps/web/public/safari-pinned-tab.svg");
console.log("  apps/web/public/og-image.png");
console.log("  apps/web/public/site.webmanifest");

function findLightVariant(path: string) {
  const parsed = parse(path);

  if (parsed.name.endsWith("_light")) {
    return existsSync(path) ? path : null;
  }

  const candidate = join(dirname(path), `${parsed.name}_light${parsed.ext}`);
  return existsSync(candidate) ? candidate : null;
}

function findCombinationVariant(path: string) {
  const parsed = parse(path);
  const name = parsed.name.endsWith("_light") ? "combination_light" : "combination";
  const candidate = join(dirname(path), `${name}${parsed.ext}`);

  return existsSync(candidate) ? candidate : null;
}

async function loadLogoSvg(path: string, ext: string) {
  if (ext === ".svg") {
    const svg = await readFile(path, "utf8");
    return {
      content: stripOuterSvg(svg),
      foreground: stripOuterSvg(svg),
      viewBox: readViewBox(svg) ?? "0 0 1000 1000",
    };
  }

  if (ext === ".ai" || ext === ".pdf") {
    const source = await readFile(path);
    return convertPdfCompatibleAiToSvg(source);
  }

  throw new Error(`Unsupported logo input: ${ext}. Use an .svg, PDF-compatible .ai, or .pdf file.`);
}

function convertPdfCompatibleAiToSvg(source: Buffer) {
  const { content, graphicsStates, xobjects } = readPdfPageContent(source);
  const shapes = parsePdfShapes(content, { graphicsStates, xobjects });
  const contentSvg = shapes.map(shapeToSvg).join("\n");
  const foregroundSvg = shapes
    .filter((shape) => shape.kind === "path")
    .map((shape) => shapeToSvg({ ...shape, color: "currentColor" }))
    .join("\n");

  return {
    content: `<g transform="matrix(1 0 0 -1 0 1000)">\n${contentSvg}\n</g>`,
    foreground: `<g transform="matrix(1 0 0 -1 0 1000)">\n${foregroundSvg}\n</g>`,
    viewBox: "0 0 1000 1000",
  };
}

function readPdfPageContent(source: Buffer) {
  const latin = source.toString("latin1");
  const contentsMatch = latin.match(/\/Contents\s+(\d+)\s+0\s+R/);
  const objectId = contentsMatch?.[1];

  if (!objectId) {
    throw new Error("Could not find the PDF page content stream in the Illustrator file.");
  }

  const objectStart = latin.indexOf(`${objectId} 0 obj`);
  const streamStart = latin.indexOf("stream", objectStart);
  const streamEnd = latin.indexOf("endstream", streamStart);

  if (objectStart < 0 || streamStart < 0 || streamEnd < 0) {
    throw new Error("Could not read the PDF page content stream in the Illustrator file.");
  }

  let stream = source.subarray(streamStart + "stream".length, streamEnd);

  if (stream[0] === 13 && stream[1] === 10) {
    stream = stream.subarray(2);
  } else if (stream[0] === 10 || stream[0] === 13) {
    stream = stream.subarray(1);
  }

  while (stream.at(-1) === 10 || stream.at(-1) === 13) {
    stream = stream.subarray(0, -1);
  }

  const xobjects = new Map<string, string>();
  const graphicsStates = new Map<string, number>();

  for (const match of latin.matchAll(/\/(GS\d+)\s+(\d+)\s+0\s+R/g)) {
    const [, name, id] = match;
    const objectStart = latin.indexOf(`${id} 0 obj`);
    const objectEnd = latin.indexOf("endobj", objectStart);
    const object = objectStart >= 0 && objectEnd >= 0 ? latin.slice(objectStart, objectEnd) : "";
    const opacity = object.match(/\/ca\s+([0-9.]+)/)?.[1] ?? object.match(/\/CA\s+([0-9.]+)/)?.[1];

    if (opacity) {
      graphicsStates.set(name, Number(opacity));
    }
  }

  for (const match of latin.matchAll(/\/(Fm\d+)\s+(\d+)\s+0\s+R/g)) {
    const [, name, id] = match;
    xobjects.set(name, readPdfStream(source, latin, id));
  }

  return {
    content: decodePdfStream(stream),
    graphicsStates,
    xobjects,
  };
}

function readPdfStream(source: Buffer, latin: string, objectId: string) {
  const objectStart = latin.indexOf(`${objectId} 0 obj`);
  const streamStart = latin.indexOf("stream", objectStart);
  const streamEnd = latin.indexOf("endstream", streamStart);

  if (objectStart < 0 || streamStart < 0 || streamEnd < 0) {
    throw new Error(`Could not read PDF stream object ${objectId}.`);
  }

  let stream = source.subarray(streamStart + "stream".length, streamEnd);

  if (stream[0] === 13 && stream[1] === 10) {
    stream = stream.subarray(2);
  } else if (stream[0] === 10 || stream[0] === 13) {
    stream = stream.subarray(1);
  }

  while (stream.at(-1) === 10 || stream.at(-1) === 13) {
    stream = stream.subarray(0, -1);
  }

  return decodePdfStream(stream);
}

function decodePdfStream(stream: Buffer) {
  try {
    return inflateSync(stream).toString("latin1");
  } catch {
    return stream.toString("latin1");
  }
}

function parsePdfShapes(
  content: string,
  resources: {
    graphicsStates: Map<string, number>;
    xobjects: Map<string, string>;
  },
  baseMatrix = [1, 0, 0, 1, 0, 0],
  baseOpacity = 1,
) {
  const tokens = content.match(/\/?[A-Za-z][A-Za-z0-9]*|-?\d*\.?\d+/g) ?? [];
  const shapes: PdfShape[] = [];
  const stack: number[] = [];
  const stateStack: Array<{ matrix: number[]; opacity: number }> = [];
  let color = brand.light;
  let matrix = [...baseMatrix];
  let opacity = baseOpacity;
  let path = "";
  let lastName = "";

  for (const token of tokens) {
    const value = Number(token);

    if (Number.isFinite(value)) {
      stack.push(value);
      continue;
    }

    if (token.startsWith("/")) {
      lastName = token.slice(1);
      continue;
    }

    switch (token) {
      case "q":
        stateStack.push({ matrix: [...matrix], opacity });
        break;
      case "Q": {
        const state = stateStack.pop();

        if (state) {
          matrix = state.matrix;
          opacity = state.opacity;
        }

        break;
      }
      case "cm": {
        const [a, b, c, d, e, f] = stack.splice(-6);
        matrix = multiplyMatrix(matrix, [a, b, c, d, e, f]);
        break;
      }
      case "scn": {
        const [r, g, b] = stack.splice(-3);
        color = rgbToHex(r, g, b);
        break;
      }
      case "m": {
        const [x, y] = stack.splice(-2);
        path += `M${trim(x)} ${trim(y)}`;
        break;
      }
      case "l": {
        const [x, y] = stack.splice(-2);
        path += `L${trim(x)} ${trim(y)}`;
        break;
      }
      case "c": {
        const [x1, y1, x2, y2, x, y] = stack.splice(-6);
        path += `C${trim(x1)} ${trim(y1)} ${trim(x2)} ${trim(y2)} ${trim(x)} ${trim(y)}`;
        break;
      }
      case "h":
        path += "Z";
        break;
      case "re": {
        const [x, y, width, height] = stack.splice(-4);

        if (path) {
          shapes.push({ color, d: path, kind: "path", opacity, transform: matrixToSvg(matrix) });
          path = "";
        }

        shapes.push({ color, height, kind: "rect", opacity, width, x, y });
        break;
      }
      case "f":
      case "F":
      case "f*":
        if (path) {
          shapes.push({ color, d: path, kind: "path", opacity, transform: matrixToSvg(matrix) });
          path = "";
        }
        break;
      case "gs":
        opacity = baseOpacity * (resources.graphicsStates.get(lastName) ?? 1);
        break;
      case "Do": {
        const xobject = resources.xobjects.get(lastName);

        if (xobject) {
          shapes.push(...parsePdfShapes(xobject, resources, matrix, opacity));
        }

        break;
      }
    }
  }

  return shapes.filter((shape) => !(shape.kind === "rect" && shape.width === 1000 && shape.height === -1000));
}

function multiplyMatrix(left: number[], right: number[]) {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function shapeToSvg(shape: PdfShape) {
  const opacity = shape.opacity < 1 ? ` fill-opacity="${trim(shape.opacity)}"` : "";

  if (shape.kind === "rect") {
    return `<rect x="${trim(shape.x)}" y="${trim(shape.y)}" width="${trim(shape.width)}" height="${trim(shape.height)}" fill="${shape.color}"${opacity}/>`;
  }

  return `<path d="${shape.d}" fill="${shape.color}"${opacity} transform="${shape.transform}"/>`;
}

function buildSchemeIconSvg(logo: {
  dark: { content: string; viewBox: string };
  light: { content: string; viewBox: string };
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.dark.viewBox}">
  <style>
    .dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .light { display: none; }
      .dark { display: inline; }
    }
  </style>
  <g class="light">
${indent(logo.light.content, 4)}
  </g>
  <g class="dark">
${indent(logo.dark.content, 4)}
  </g>
</svg>
`;
}

function buildStaticIconSvg(logo: { content: string; viewBox: string }, size: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${logo.viewBox}">
${indent(logo.content, 2)}
</svg>
`;
}

function buildMaskableIconSvg(logo: { foreground: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1000 1000">
  <rect width="1000" height="1000" fill="${brand.dark}"/>
  <g color="${brand.light}" transform="translate(90 90) scale(0.82)">
${indent(logo.foreground, 4)}
  </g>
</svg>
`;
}

function buildPinnedTabSvg(logo: { foreground: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <g color="#000000">
${indent(logo.foreground, 4)}
  </g>
</svg>
`;
}

function buildOgImageSvg(logo: { content: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <g transform="translate(0 -285) scale(1.2)">
${indent(logo.content, 4)}
  </g>
</svg>
`;
}

function buildManifest() {
  return {
    background_color: brand.themeLight,
    display: "standalone",
    icons: [
      { sizes: "192x192", src: "/icon-192.png", type: "image/png" },
      { sizes: "512x512", src: "/icon-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icon-maskable-512.png", type: "image/png" },
    ],
    name: "quieter",
    short_name: "quieter",
    start_url: "/",
    theme_color: brand.themeLight,
  };
}

function renderSvg(inputPath: string, outputPath: string, width: number, height: number) {
  const result = Bun.spawnSync({
    cmd: [
      "bunx",
      "--bun",
      "@resvg/resvg-js-cli",
      "--fit-width",
      String(width),
      "--fit-height",
      String(height),
      inputPath,
      outputPath,
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  if (!result.success) {
    throw new Error(`Failed to render ${outputPath}: ${result.stderr.toString()}`);
  }
}

function buildIco(pngs: Buffer[], sizes: number[]) {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + pngs.length * entrySize;
  const imageSize = pngs.reduce((total, png) => total + png.length, 0);
  const ico = Buffer.alloc(directorySize + imageSize);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(pngs.length, 4);

  let imageOffset = directorySize;

  pngs.forEach((png, index) => {
    const entryOffset = headerSize + index * entrySize;
    ico.writeUInt8(sizes[index], entryOffset);
    ico.writeUInt8(sizes[index], entryOffset + 1);
    ico.writeUInt8(0, entryOffset + 2);
    ico.writeUInt8(0, entryOffset + 3);
    ico.writeUInt16LE(1, entryOffset + 4);
    ico.writeUInt16LE(32, entryOffset + 6);
    ico.writeUInt32LE(png.length, entryOffset + 8);
    ico.writeUInt32LE(imageOffset, entryOffset + 12);
    png.copy(ico, imageOffset);
    imageOffset += png.length;
  });

  return ico;
}

function stripOuterSvg(svg: string) {
  return svg
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<svg\b[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();
}

function readViewBox(svg: string) {
  return svg.match(/\bviewBox=["']([^"']+)["']/i)?.[1];
}

function rgbToHex(red: number, green: number, blue: number) {
  const toHex = (channel: number) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function matrixToSvg(matrix: number[]) {
  return `matrix(${matrix.map(trim).join(" ")})`;
}

function trim(value: number) {
  return Number(value.toFixed(4)).toString();
}

function indent(value: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}
