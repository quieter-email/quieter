import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

const projectRoot = path.resolve(import.meta.dirname, "..");
const webPublicDir = path.resolve(projectRoot, "apps/web/public");
const tempDir = path.resolve(webPublicDir, ".asset-tmp");
const resvgCliPath = path.join(
  projectRoot,
  "node_modules",
  "@resvg",
  "resvg-js-cli",
  "bin",
  "resvg-js-cli.mjs"
);

const brand = {
  dark: "#1a1a1a",
  devDark: "#8f3b16",
  devLight: "#ffe7b8",
  light: "#f2f2f2",
  page: "#f7f4ee",
  themeDark: "#141414",
  themeLight: "#f7f4ee",
};

type LogoSvg = {
  content: string;
  foreground: string;
  viewBox: string;
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

const trim = (value: number) => Number(value.toFixed(4)).toString();

const indent = (value: string, spaces: number) => {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
};

const channelToHex = (channel: number) =>
  Math.round(channel * 255)
    .toString(16)
    .padStart(2, "0");

const rgbToHex = (red: number, green: number, blue: number) =>
  `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;

const matrixToSvg = (matrix: number[]) =>
  `matrix(${matrix.map(trim).join(" ")})`;

const stripOuterSvg = (svg: string) => {
  let output = svg;
  output = output.replace(/<\?xml[^>]*>/u, "");
  output = output.replace(/<!doctype[^>]*>/iu, "");
  output = output.replace(/<svg\b[^>]*>/iu, "");
  output = output.replace(/<\/svg>\s*$/iu, "");
  return output.trim();
};

const viewBoxPattern = /\bviewBox=["'](?<viewBox>[^"']+)["']/iu;
const pdfContentsPattern = /\/Contents\s+(?<objectId>\d+)\s+0\s+R/u;
const pdfGraphicsStateAlphaPattern = /\/ca\s+(?<alpha>[0-9.]+)/u;
const pdfGraphicsStateAlphaCapitalPattern = /\/CA\s+(?<alpha>[0-9.]+)/u;

const isPresentString = (value: string | null | undefined): value is string =>
  (value ?? "") !== "";

const readViewBox = (svg: string) => viewBoxPattern.exec(svg)?.groups?.viewBox;

const multiplyMatrix = (left: number[], right: number[]) => {
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
};

const shapeToSvg = (shape: PdfShape) => {
  const opacity =
    shape.opacity < 1 ? ` fill-opacity="${trim(shape.opacity)}"` : "";

  if (shape.kind === "rect") {
    return `<rect x="${trim(shape.x)}" y="${trim(shape.y)}" width="${trim(shape.width)}" height="${trim(shape.height)}" fill="${shape.color}"${opacity}/>`;
  }

  return `<path d="${shape.d}" fill="${shape.color}"${opacity} transform="${shape.transform}"/>`;
};

const findLightVariant = (filePath: string) => {
  const parsed = path.parse(filePath);

  if (parsed.name.endsWith("_light")) {
    return existsSync(filePath) ? filePath : null;
  }

  const candidate = path.join(
    path.dirname(filePath),
    `${parsed.name}_light${parsed.ext}`
  );
  return existsSync(candidate) ? candidate : null;
};

const findCombinationVariant = (filePath: string) => {
  const parsed = path.parse(filePath);
  const name = parsed.name.endsWith("_light")
    ? "combination_light"
    : "combination";
  const candidate = path.join(path.dirname(filePath), `${name}${parsed.ext}`);

  return existsSync(candidate) ? candidate : null;
};

const decodePdfStream = (stream: Buffer) => {
  try {
    return inflateSync(stream).toString("latin1");
  } catch {
    return stream.toString("latin1");
  }
};

const normalizePdfStreamBytes = (stream: Buffer) => {
  let normalized = stream;

  if (normalized[0] === 13 && normalized[1] === 10) {
    normalized = normalized.subarray(2);
  } else if (normalized[0] === 10 || normalized[0] === 13) {
    normalized = normalized.subarray(1);
  }

  while (normalized.at(-1) === 10 || normalized.at(-1) === 13) {
    normalized = normalized.subarray(0, -1);
  }

  return normalized;
};

const readPdfStream = (source: Buffer, latin: string, objectId: string) => {
  const objectStart = latin.indexOf(`${objectId} 0 obj`);
  const streamStart = latin.indexOf("stream", objectStart);
  const streamEnd = latin.indexOf("endstream", streamStart);

  if (objectStart === -1 || streamStart === -1 || streamEnd === -1) {
    throw new Error(`Could not read PDF stream object ${objectId}.`);
  }

  const stream = source.subarray(streamStart + "stream".length, streamEnd);
  return decodePdfStream(normalizePdfStreamBytes(stream));
};

const readGraphicsStateOpacity = (object: string) =>
  pdfGraphicsStateAlphaPattern.exec(object)?.groups?.alpha ??
  pdfGraphicsStateAlphaCapitalPattern.exec(object)?.groups?.alpha;

const readPdfGraphicsStates = (latin: string) => {
  const graphicsStates = new Map<string, number>();

  for (const match of latin.matchAll(
    /\/(?<name>GS\d+)\s+(?<id>\d+)\s+0\s+R/gu
  )) {
    const name = match.groups?.name;
    const id = match.groups?.id;
    if (!isPresentString(name) || !isPresentString(id)) {
      continue;
    }
    const matchObjectStart = latin.indexOf(`${id} 0 obj`);
    const objectEnd = latin.indexOf("endobj", matchObjectStart);
    const object =
      matchObjectStart !== -1 && objectEnd !== -1
        ? latin.slice(matchObjectStart, objectEnd)
        : "";
    const opacity = readGraphicsStateOpacity(object);

    if (opacity !== undefined && opacity !== "") {
      graphicsStates.set(name, Number(opacity));
    }
  }

  return graphicsStates;
};

const readPdfXObjects = (source: Buffer, latin: string) => {
  const xobjects = new Map<string, string>();

  for (const match of latin.matchAll(
    /\/(?<name>Fm\d+)\s+(?<id>\d+)\s+0\s+R/gu
  )) {
    const name = match.groups?.name;
    const id = match.groups?.id;
    if (!isPresentString(name) || !isPresentString(id)) {
      continue;
    }
    xobjects.set(name, readPdfStream(source, latin, id));
  }

  return xobjects;
};

const readPdfPageContent = (source: Buffer) => {
  const latin = source.toString("latin1");
  const contentsMatch = pdfContentsPattern.exec(latin);
  const objectId = contentsMatch?.groups?.objectId;

  if (!isPresentString(objectId)) {
    throw new Error(
      "Could not find the PDF page content stream in the Illustrator file."
    );
  }

  const objectStart = latin.indexOf(`${objectId} 0 obj`);
  const streamStart = latin.indexOf("stream", objectStart);
  const streamEnd = latin.indexOf("endstream", streamStart);

  if (objectStart === -1 || streamStart === -1 || streamEnd === -1) {
    throw new Error(
      "Could not read the PDF page content stream in the Illustrator file."
    );
  }

  const stream = source.subarray(streamStart + "stream".length, streamEnd);

  return {
    content: decodePdfStream(normalizePdfStreamBytes(stream)),
    graphicsStates: readPdfGraphicsStates(latin),
    xobjects: readPdfXObjects(source, latin),
  };
};

type PdfParseState = {
  color: string;
  lastName: string;
  matrix: number[];
  opacity: number;
  shapes: PdfShape[];
  stack: number[];
  stateStack: { matrix: number[]; opacity: number }[];
  svgPath: string;
};

const pushCurrentPdfPath = (state: PdfParseState) => {
  if ((state.svgPath ?? "") === "") {
    return;
  }

  state.shapes.push({
    color: state.color,
    d: state.svgPath,
    kind: "path",
    opacity: state.opacity,
    transform: matrixToSvg(state.matrix),
  });
  state.svgPath = "";
};

const applyPdfToken = (
  token: string,
  state: PdfParseState,
  resources: {
    graphicsStates: Map<string, number>;
    xobjects: Map<string, string>;
  },
  baseOpacity: number,
  parseNestedShapes: (
    nestedContent: string,
    nestedMatrix: number[],
    nestedOpacity: number
  ) => PdfShape[]
) => {
  switch (token) {
    case "q": {
      state.stateStack.push({
        matrix: [...state.matrix],
        opacity: state.opacity,
      });
      break;
    }
    case "Q": {
      const previousState = state.stateStack.pop();
      if (previousState !== undefined) {
        const { matrix, opacity } = previousState;
        state.matrix = matrix;
        state.opacity = opacity;
      }
      break;
    }
    case "cm": {
      const [a, b, c, d, e, f] = state.stack.splice(-6);
      state.matrix = multiplyMatrix(state.matrix, [a, b, c, d, e, f]);
      break;
    }
    case "scn": {
      const [r, g, b] = state.stack.splice(-3);
      state.color = rgbToHex(r, g, b);
      break;
    }
    case "m": {
      const [x, y] = state.stack.splice(-2);
      state.svgPath += `M${trim(x)} ${trim(y)}`;
      break;
    }
    case "l": {
      const [x, y] = state.stack.splice(-2);
      state.svgPath += `L${trim(x)} ${trim(y)}`;
      break;
    }
    case "c": {
      const [x1, y1, x2, y2, x, y] = state.stack.splice(-6);
      state.svgPath += `C${trim(x1)} ${trim(y1)} ${trim(x2)} ${trim(y2)} ${trim(x)} ${trim(y)}`;
      break;
    }
    case "h": {
      state.svgPath += "Z";
      break;
    }
    case "re": {
      const [x, y, width, height] = state.stack.splice(-4);
      pushCurrentPdfPath(state);
      state.shapes.push({
        color: state.color,
        height,
        kind: "rect",
        opacity: state.opacity,
        width,
        x,
        y,
      });
      break;
    }
    case "f":
    case "F":
    case "f*": {
      pushCurrentPdfPath(state);
      break;
    }
    case "gs": {
      state.opacity =
        baseOpacity * (resources.graphicsStates.get(state.lastName) ?? 1);
      break;
    }
    case "Do": {
      const xobject = resources.xobjects.get(state.lastName);
      if (xobject !== undefined) {
        state.shapes.push(
          ...parseNestedShapes(xobject, state.matrix, state.opacity)
        );
      }
      break;
    }
    default: {
      break;
    }
  }
};

const parsePdfShapes = (
  content: string,
  resources: {
    graphicsStates: Map<string, number>;
    xobjects: Map<string, string>;
  },
  baseMatrix = [1, 0, 0, 1, 0, 0],
  baseOpacity = 1
) => {
  const tokens = content.match(/\/?[A-Za-z][A-Za-z0-9]*|-?\d*\.?\d+/gu) ?? [];
  const state: PdfParseState = {
    color: brand.light,
    lastName: "",
    matrix: [...baseMatrix],
    opacity: baseOpacity,
    shapes: [],
    stack: [],
    stateStack: [],
    svgPath: "",
  };
  const parseNestedShapes = (
    nestedContent: string,
    nestedMatrix: number[],
    nestedOpacity: number
  ) => parsePdfShapes(nestedContent, resources, nestedMatrix, nestedOpacity);

  for (const token of tokens) {
    const value = Number(token);

    if (Number.isFinite(value)) {
      state.stack.push(value);
      continue;
    }

    if (token.startsWith("/")) {
      state.lastName = token.slice(1);
      continue;
    }

    applyPdfToken(token, state, resources, baseOpacity, parseNestedShapes);
  }

  return state.shapes.filter(
    (shape) =>
      !(shape.kind === "rect" && shape.width === 1000 && shape.height === -1000)
  );
};

const convertPdfCompatibleAiToSvg = (source: Buffer) => {
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
};

const loadLogoSvg = async (filePath: string, ext: string): Promise<LogoSvg> => {
  if (ext === ".svg") {
    const svg = await readFile(filePath, "utf-8");
    return {
      content: stripOuterSvg(svg),
      foreground: stripOuterSvg(svg),
      viewBox: readViewBox(svg) ?? "0 0 1000 1000",
    };
  }

  if (ext === ".ai" || ext === ".pdf") {
    const source = await readFile(filePath);
    return convertPdfCompatibleAiToSvg(source);
  }

  throw new Error(
    `Unsupported logo input: ${ext}. Use an .svg, PDF-compatible .ai, or .pdf file.`
  );
};

const recolorLogo = (
  logoAsset: LogoSvg,
  dark: string,
  light: string
): LogoSvg => {
  const recolor = (value: string) =>
    value.replaceAll(brand.dark, dark).replaceAll(brand.light, light);

  return {
    content: recolor(logoAsset.content),
    foreground: recolor(logoAsset.foreground),
    viewBox: logoAsset.viewBox,
  };
};

const buildSchemeIconSvg = (logoAsset: {
  dark: { content: string; viewBox: string };
  light: { content: string; viewBox: string };
}) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logoAsset.dark.viewBox}">
  <style>
    .dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .light { display: none; }
      .dark { display: inline; }
    }
  </style>
  <g class="light">
${indent(logoAsset.light.content, 4)}
  </g>
  <g class="dark">
${indent(logoAsset.dark.content, 4)}
  </g>
</svg>
`;

const buildStaticIconSvg = (
  logoAsset: { content: string; viewBox: string },
  size: number
) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${logoAsset.viewBox}">
${indent(logoAsset.content, 2)}
</svg>
`;

const buildMaskableIconSvg = (logoAsset: { foreground: string }) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1000 1000">
  <rect width="1000" height="1000" fill="${brand.dark}"/>
  <g color="${brand.light}" transform="translate(90 90) scale(0.82)">
${indent(logoAsset.foreground, 4)}
  </g>
</svg>
`;

const buildPinnedTabSvg = (logoAsset: { foreground: string }) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <g color="#000000">
${indent(logoAsset.foreground, 4)}
  </g>
</svg>
`;

const buildOgImageSvg = (logoAsset: { content: string }) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <g transform="translate(0 -285) scale(1.2)">
${indent(logoAsset.content, 4)}
  </g>
</svg>
`;

const buildManifest = () => ({
  background_color: brand.themeLight,
  display: "standalone",
  icons: [
    { sizes: "192x192", src: "/icon-192.png", type: "image/png" },
    { sizes: "512x512", src: "/icon-512.png", type: "image/png" },
    {
      purpose: "maskable",
      sizes: "512x512",
      src: "/icon-maskable-512.png",
      type: "image/png",
    },
  ],
  name: "quieter",
  protocol_handlers: [
    { protocol: "mailto", url: "/?compose=mailto&mailto=%s" },
  ],
  short_name: "quieter",
  start_url: "/",
  theme_color: brand.themeLight,
});

const renderSvg = (
  inputPath: string,
  outputPath: string,
  width: number,
  height: number
) => {
  const result = spawnSync(
    process.execPath,
    [
      resvgCliPath,
      "--fit-width",
      String(width),
      "--fit-height",
      String(height),
      inputPath,
      outputPath,
    ],
    { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] }
  );

  if (result.error !== undefined || result.status !== 0) {
    const stderrText = result.stderr.toString().trim();
    const reason =
      stderrText === ""
        ? (result.error?.message ?? `exit code ${result.status}`)
        : stderrText;
    throw new Error(`Failed to render ${outputPath}: ${reason}`);
  }
};

const buildIco = (pngs: Buffer[], sizes: number[]) => {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + pngs.length * entrySize;
  let imageSize = 0;
  for (const png of pngs) {
    imageSize += png.length;
  }
  const ico = Buffer.alloc(directorySize + imageSize);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(pngs.length, 4);

  let imageOffset = directorySize;

  for (const [index, png] of pngs.entries()) {
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
  }

  return ico;
};

const main = async () => {
  const args = process.argv.slice(2);
  const inputArg = args.find((arg) => !arg.startsWith("--"));
  if (!isPresentString(inputArg)) {
    process.stderr.write(
      "Usage: node scripts/generate-web-assets.ts <path-to-logo.svg|logo.ai>\n"
    );
    throw new Error("A logo input path is required.");
  }

  const sourcePath = path.isAbsolute(inputArg)
    ? inputArg
    : path.resolve(projectRoot, inputArg);
  const sourceName = path.basename(sourcePath);
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const lightPath = findLightVariant(sourcePath);
  const combinationPath = findCombinationVariant(sourcePath);

  await mkdir(webPublicDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  const logo = await loadLogoSvg(sourcePath, sourceExt);
  const lightLogo = isPresentString(lightPath)
    ? await loadLogoSvg(lightPath, path.extname(lightPath).toLowerCase())
    : undefined;
  const ogLogo = isPresentString(combinationPath)
    ? await loadLogoSvg(
        combinationPath,
        path.extname(combinationPath).toLowerCase()
      )
    : logo;

  await writeFile(
    path.resolve(webPublicDir, "icon.svg"),
    lightLogo === undefined
      ? buildStaticIconSvg(logo, 1000)
      : buildSchemeIconSvg({ dark: logo, light: lightLogo })
  );
  const environmentIcons =
    lightLogo === undefined
      ? []
      : [
          {
            file: "dev",
            staticLogo: recolorLogo(logo, brand.devDark, brand.devLight),
            svg: buildSchemeIconSvg({
              dark: recolorLogo(logo, brand.devDark, brand.devLight),
              light: recolorLogo(lightLogo, brand.devDark, brand.devLight),
            }),
          },
        ];

  await Promise.all(
    environmentIcons.map(async (icon) => {
      await writeFile(
        path.resolve(webPublicDir, `icon-${icon.file}.svg`),
        icon.svg
      );
    })
  );
  await writeFile(
    path.resolve(webPublicDir, "safari-pinned-tab.svg"),
    buildPinnedTabSvg(logo)
  );
  await writeFile(
    path.resolve(webPublicDir, "site.webmanifest"),
    `${JSON.stringify(buildManifest(), null, 2)}\n`
  );

  const renderJobs = [
    {
      file: "apple-touch-icon.png",
      size: 180,
      svg: buildStaticIconSvg(logo, 1000),
    },
    { file: "icon-192.png", size: 192, svg: buildStaticIconSvg(logo, 1000) },
    { file: "icon-512.png", size: 512, svg: buildStaticIconSvg(logo, 1000) },
    {
      file: "icon-maskable-512.png",
      size: 512,
      svg: buildMaskableIconSvg(logo),
    },
    {
      file: "og-image.png",
      height: 630,
      size: 1200,
      svg: buildOgImageSvg(ogLogo),
    },
  ];

  await Promise.all(
    renderJobs.map(async (job) => {
      const svgPath = path.resolve(tempDir, `${job.file}.svg`);
      const outputPath = path.resolve(webPublicDir, job.file);
      await writeFile(svgPath, job.svg);
      renderSvg(svgPath, outputPath, job.size, job.height ?? job.size);
    })
  );

  const favicons = [
    { file: "favicon", svg: buildStaticIconSvg(logo, 1000) },
    ...environmentIcons.map((icon) => ({
      file: `favicon-${icon.file}`,
      svg: buildStaticIconSvg(icon.staticLogo, 1000),
    })),
  ];

  await Promise.all(
    favicons.map(async (favicon) => {
      const favicon16 = path.resolve(tempDir, `${favicon.file}-16.png`);
      const favicon32 = path.resolve(tempDir, `${favicon.file}-32.png`);
      const faviconSvg = path.resolve(tempDir, `${favicon.file}.svg`);
      await writeFile(faviconSvg, favicon.svg);
      renderSvg(faviconSvg, favicon16, 16, 16);
      renderSvg(faviconSvg, favicon32, 32, 32);
      await writeFile(
        path.resolve(webPublicDir, `${favicon.file}.ico`),
        buildIco(
          [await readFile(favicon16), await readFile(favicon32)],
          [16, 32]
        )
      );
    })
  );

  await rm(tempDir, { force: true, recursive: true });

  const generatedAssets = [
    `Generated web assets from ${sourceName}:`,
    `  source: ${sourcePath}`,
    ...(isPresentString(lightPath) ? [`  light variant: ${lightPath}`] : []),
    ...(isPresentString(combinationPath)
      ? [`  og source: ${combinationPath}`]
      : []),
    "  apps/web/public/favicon.ico",
    "  apps/web/public/favicon-dev.ico",
    "  apps/web/public/icon.svg",
    "  apps/web/public/icon-dev.svg",
    "  apps/web/public/apple-touch-icon.png",
    "  apps/web/public/icon-192.png",
    "  apps/web/public/icon-512.png",
    "  apps/web/public/icon-maskable-512.png",
    "  apps/web/public/safari-pinned-tab.svg",
    "  apps/web/public/og-image.png",
    "  apps/web/public/site.webmanifest",
  ];
  process.stdout.write(`${generatedAssets.join("\n")}\n`);
};

await main();
