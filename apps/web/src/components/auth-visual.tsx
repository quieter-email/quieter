"use client";

import { useEffect, useRef } from "react";

const dotGap = 4;
const maxCanvasPixelCount = 2_200_000;
const maxDevicePixelRatio = 1.5;
const maxWaveCount = 24;
const particleRenderStride = 6;
const particleRenderStrideBytes = particleRenderStride * Float32Array.BYTES_PER_ELEMENT;
const targetParticleGridCells = 54_000;

type Point = {
  x: number;
  y: number;
};

type Rgb = [number, number, number];

type Dot = Point & {
  opacity: number;
  radius: number;
  vibrance: number;
};

type Wave = Point & {
  activatedRadius: number;
  force: number;
  life: number;
  speed: number;
  startedAt: number;
  width: number;
};

type WaveFrame = Wave & {
  envelope: number;
  frontRadius: number;
  innerRadiusSquared: number;
  outerRadiusSquared: number;
};

type Colors = {
  background: Rgb;
  primary: Rgb;
};

const vertexShaderSource = `#version 300 es
in vec2 aCenter;
in float aRadius;
in float aOpacity;
in float aVibrance;
in float aEnergy;

out float vOpacity;
out float vPointSize;
out float vRadius;
out float vVibrance;
out float vEnergy;

uniform vec2 uResolution;

void main() {
  float energy = clamp(aEnergy, 0.0, 1.0);
  float shimmer = smoothstep(0.72, 1.0, aVibrance) * 0.12;
  float radius = aRadius + energy * 0.12 + shimmer;

  vOpacity = aOpacity;
  vVibrance = aVibrance;
  vEnergy = energy;
  vRadius = radius;
  vPointSize = (radius + 0.72) * 2.0;

  gl_PointSize = vPointSize;
  gl_Position = vec4(aCenter.x / uResolution.x * 2.0 - 1.0, 1.0 - aCenter.y / uResolution.y * 2.0, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

in float vOpacity;
in float vPointSize;
in float vRadius;
in float vVibrance;
in float vEnergy;

out vec4 outColor;

uniform vec3 uColor;
uniform float uTime;

void main() {
  float distanceValue = length((gl_PointCoord - 0.5) * vPointSize);
  float core = 1.0 - smoothstep(max(vRadius - 0.72, 0.0), vRadius + 0.78, distanceValue);
  float shimmerSeed = smoothstep(0.68, 1.0, vVibrance);
  float shimmer = (sin(uTime * mix(1.2, 2.8, vVibrance) + vVibrance * 41.0) * 0.5 + 0.5) * shimmerSeed;
  float alpha = min(core * vOpacity * (0.94 + shimmer * 0.1 + vEnergy * 0.08), 1.0);

  outColor = vec4(uColor, alpha);
}
`;

const fract = (value: number) => value - Math.floor(value);

const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);

const mix = (start: number, end: number, amount: number) => start * (1 - amount) + end * amount;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
};

const oklchGrayToSrgb = (lightness: number) => {
  const linear = lightness ** 3;

  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
};

const getCssColor = (element: HTMLElement, property: string, fallback: Rgb): Rgb => {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  const oklchMatch = /^oklch\(\s*([\d.]+)(%)?/.exec(value);

  if (oklchMatch) {
    const lightness = Number(oklchMatch[1]) / (oklchMatch[2] ? 100 : 1);
    const channel = oklchGrayToSrgb(lightness);

    return [channel, channel, channel];
  }

  const rgbMatch = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);

  if (rgbMatch) {
    return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  }

  const srgbMatch = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);

  if (srgbMatch) {
    return [Number(srgbMatch[1]), Number(srgbMatch[2]), Number(srgbMatch[3])];
  }

  return fallback;
};

const readColors = (canvas: HTMLCanvasElement): Colors => {
  const background = getCssColor(
    canvas,
    "background-color",
    getCssColor(canvas, "--background", [0.02, 0.02, 0.02]),
  );
  const primary = getCssColor(canvas, "--primary", [0.25, 0.25, 0.25]);

  return {
    background,
    primary,
  };
};

const squircleRadius = (point: Point, scale: number, width: number, height: number) => {
  const unit = Math.min(width, height) / 10;
  const offsetX = point.x - width * 0.5;
  const offsetY = point.y - height * 0.5;
  const localX = (offsetX * Math.SQRT1_2 + offsetY * Math.SQRT1_2) / scale;
  const localY = (-offsetX * Math.SQRT1_2 + offsetY * Math.SQRT1_2) / scale;
  const radius = 2 ** 0.25 * unit * 2;
  const distanceValue = (Math.abs(localX) / radius) ** 3.25 + (Math.abs(localY) / radius) ** 3.25;

  return distanceValue ** (1 / 3.25);
};

const appendNoiseDot = (
  dots: Dot[],
  cellX: number,
  cellY: number,
  gap: number,
  width: number,
  height: number,
) => {
  const jitterX = hash(cellX + 53, cellY + 53) - 0.5;
  const jitterY = hash(cellX + 193, cellY + 193) - 0.5;
  const radiusScale = clamp((gap / dotGap) ** 0.42, 1, 1.42);
  const center = {
    x: (cellX + 0.5) * gap + jitterX * gap,
    y: (cellY + 0.5) * gap + jitterY * gap,
  };
  const outerRadius = squircleRadius(center, 1, width, height);
  const nearestRadius = Math.min(
    outerRadius,
    squircleRadius(center, 0.9, width, height),
    squircleRadius(center, 0.8, width, height),
    squircleRadius(center, 0.7, width, height),
  );
  const insideOuter = 1 - smoothstep(0.94, 1.08, outerRadius);
  const edgeScatter = 1 - smoothstep(0, 0.7, Math.abs(nearestRadius - 1));
  const innerScatter = (nearestRadius < 1 ? 1 : 0) * (1 - smoothstep(0, 0.85, 1 - nearestRadius));
  const outerScatter = (nearestRadius >= 1 ? 1 : 0) * (1 - smoothstep(0, 0.95, nearestRadius - 1));
  const logoScatter = Math.max(edgeScatter, innerScatter, outerScatter);
  const density = clamp(0.44 + logoScatter * 0.38, 0, 0.97);

  if (density < hash(cellX + 719, cellY + 719)) return;

  const radiusSeed = hash(cellX + 389, cellY + 389);

  dots.push({
    ...center,
    opacity: mix(1, 0.2, insideOuter),
    radius: mix(0.25 + radiusSeed * 0.65, 0.45 + radiusSeed * 1.35, logoScatter) * radiusScale,
    vibrance: hash(cellX + 941, cellY + 941),
  });
};

const layerScale = (index: number) => {
  if (index === 0) return 1;
  if (index === 1) return 0.9;
  if (index === 2) return 0.8;
  return 0.7;
};

const layerOpacity = (index: number) => {
  if (index === 0) return 1;
  if (index === 1) return 0.8;
  if (index === 2) return 0.6;
  return 0.4;
};

const appendRingDot = (
  dots: Dot[],
  cellX: number,
  cellY: number,
  layerIndex: number,
  gap: number,
  width: number,
  height: number,
) => {
  const unit = Math.min(width, height) / 10;
  const radius = 2 ** 0.25 * unit * 2;
  const halfRingWidth = (unit * 0.22 * 2) / radius / 2;
  const scale = layerScale(layerIndex);
  const opacity = layerOpacity(layerIndex);
  const seedX = cellX + layerIndex * 101;
  const seedY = cellY + layerIndex * 211;
  const jitterX = hash(seedX, seedY) - 0.5;
  const jitterY = hash(seedY, seedX) - 0.5;
  const radiusScale = clamp((gap / dotGap) ** 0.42, 1, 1.42);
  const center = {
    x: (cellX + 0.5) * gap + jitterX * gap * 0.38,
    y: (cellY + 0.5) * gap + jitterY * gap * 0.38,
  };
  const radiusValue = squircleRadius(center, scale, width, height);
  const distanceFromCenterLine = Math.abs(radiusValue - 1);

  if (distanceFromCenterLine > halfRingWidth) return;

  const distanceFromRingEdge = halfRingWidth - distanceFromCenterLine;
  const edgeAmount = clamp(1 - distanceFromRingEdge / halfRingWidth, 0, 1);
  const edgeStrength = edgeAmount ** 0.35;
  const density = edgeAmount > 0.62 ? 1 : 0.12 + edgeStrength * 0.58;

  if (density < hash(seedX + 29, seedY + 29)) return;

  dots.push({
    ...center,
    opacity: opacity * (0.12 + edgeStrength * 0.88),
    radius: (0.35 + edgeStrength * 1.55) * scale * radiusScale,
    vibrance: hash(seedX + 463, seedY + 463),
  });
};

const buildDots = (width: number, height: number, gap: number) => {
  const unit = Math.min(width, height) / 10;
  const margin = Math.ceil((Math.max(15, unit * 0.13 + 2) + gap) / gap);
  const minCellX = -margin;
  const maxCellX = Math.ceil(width / gap) + margin;
  const minCellY = -margin;
  const maxCellY = Math.ceil(height / gap) + margin;
  const dots: Dot[] = [];

  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      appendNoiseDot(dots, cellX, cellY, gap, width, height);

      for (let layerIndex = 0; layerIndex < 4; layerIndex += 1) {
        appendRingDot(dots, cellX, cellY, layerIndex, gap, width, height);
      }
    }
  }

  return dots;
};

const createShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;

  gl.deleteShader(shader);
  return null;
};

const createProgram = (gl: WebGL2RenderingContext) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;

  gl.deleteProgram(program);
  return null;
};

export const AuthVisual = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const gl =
      canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        desynchronized: true,
        powerPreference: "high-performance",
        stencil: false,
      }) ??
      canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        powerPreference: "high-performance",
        stencil: false,
      });
    if (!gl) return;

    const program = createProgram(gl);
    if (!program) return;

    const centerAttribute = gl.getAttribLocation(program, "aCenter");
    const radiusAttribute = gl.getAttribLocation(program, "aRadius");
    const opacityAttribute = gl.getAttribLocation(program, "aOpacity");
    const vibranceAttribute = gl.getAttribLocation(program, "aVibrance");
    const energyAttribute = gl.getAttribLocation(program, "aEnergy");
    const resolutionUniform = gl.getUniformLocation(program, "uResolution");
    const colorUniform = gl.getUniformLocation(program, "uColor");
    const timeUniform = gl.getUniformLocation(program, "uTime");

    if (
      centerAttribute < 0 ||
      radiusAttribute < 0 ||
      opacityAttribute < 0 ||
      vibranceAttribute < 0 ||
      energyAttribute < 0 ||
      !resolutionUniform ||
      !colorUniform ||
      !timeUniform
    )
      return;

    const particleBuffer = gl.createBuffer();
    if (!particleBuffer) return;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
    gl.enableVertexAttribArray(centerAttribute);
    gl.enableVertexAttribArray(radiusAttribute);
    gl.enableVertexAttribArray(opacityAttribute);
    gl.enableVertexAttribArray(vibranceAttribute);
    gl.enableVertexAttribArray(energyAttribute);
    gl.vertexAttribPointer(centerAttribute, 2, gl.FLOAT, false, particleRenderStrideBytes, 0);
    gl.vertexAttribPointer(
      radiusAttribute,
      1,
      gl.FLOAT,
      false,
      particleRenderStrideBytes,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribPointer(
      opacityAttribute,
      1,
      gl.FLOAT,
      false,
      particleRenderStrideBytes,
      3 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribPointer(
      vibranceAttribute,
      1,
      gl.FLOAT,
      false,
      particleRenderStrideBytes,
      4 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribPointer(
      energyAttribute,
      1,
      gl.FLOAT,
      false,
      particleRenderStrideBytes,
      5 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(centerAttribute, 1);
    gl.vertexAttribDivisor(radiusAttribute, 1);
    gl.vertexAttribDivisor(opacityAttribute, 1);
    gl.vertexAttribDivisor(vibranceAttribute, 1);
    gl.vertexAttribDivisor(energyAttribute, 1);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let animationFrame = 0;
    let bufferWidth = 0;
    let bufferHeight = 0;
    let cssWidth = 1;
    let cssHeight = 1;
    let particleGap = dotGap;
    let particleCount = 0;
    let bucketSize = 80;
    let bucketMinX = 0;
    let bucketMinY = 0;
    let bucketColumnCount = 0;
    let bucketRowCount = 0;
    let particleBuckets: number[][] = [];
    let canvasRect = canvas.getBoundingClientRect();
    let baseX = new Float32Array(0);
    let baseY = new Float32Array(0);
    let positionX = new Float32Array(0);
    let positionY = new Float32Array(0);
    let velocityX = new Float32Array(0);
    let velocityY = new Float32Array(0);
    let radius = new Float32Array(0);
    let opacity = new Float32Array(0);
    let vibrance = new Float32Array(0);
    let energy = new Float32Array(0);
    let renderData = new Float32Array(0);
    let activeFlags = new Uint8Array(0);
    let activeIndices: number[] = [];
    let waves: Wave[] = [];
    let cursorTarget: Point | null = null;
    let cursorPosition: Point | null = null;
    let cursorVelocityX = 0;
    let cursorVelocityY = 0;
    let cursorStrength = 0;
    let isPointerInside = false;
    let lastRenderTime = 0;
    let particlesSettled = true;
    const canAnimateParticles = !globalThis.window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const canTrackCursor =
      canAnimateParticles &&
      globalThis.window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let colors = readColors(canvas);

    const refreshColors = () => {
      colors = readColors(canvas);
    };

    const toCanvasPoint = (clientPoint: Point, requireInside: boolean) => {
      const xCss = clientPoint.x - canvasRect.left;
      const yCss = clientPoint.y - canvasRect.top;
      const isInside = xCss >= 0 && xCss <= cssWidth && yCss >= 0 && yCss <= cssHeight;

      if (requireInside && !isInside) return null;

      return {
        x: (xCss * bufferWidth) / cssWidth,
        y: (yCss * bufferHeight) / cssHeight,
      };
    };

    const writeParticleData = () => {
      for (let index = 0; index < particleCount; index += 1) {
        const offset = index * particleRenderStride;

        renderData[offset] = positionX[index];
        renderData[offset + 1] = positionY[index];
        renderData[offset + 2] = radius[index];
        renderData[offset + 3] = opacity[index];
        renderData[offset + 4] = vibrance[index];
        renderData[offset + 5] = energy[index];
      }
    };

    const syncParticleBuckets = () => {
      bucketSize = clamp(particleGap * 12, 56, 132);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let index = 0; index < particleCount; index += 1) {
        minX = Math.min(minX, baseX[index]);
        minY = Math.min(minY, baseY[index]);
        maxX = Math.max(maxX, baseX[index]);
        maxY = Math.max(maxY, baseY[index]);
      }

      bucketMinX = Math.floor(minX / bucketSize);
      bucketMinY = Math.floor(minY / bucketSize);
      bucketColumnCount = Math.max(1, Math.floor(maxX / bucketSize) - bucketMinX + 1);
      bucketRowCount = Math.max(1, Math.floor(maxY / bucketSize) - bucketMinY + 1);
      particleBuckets = Array.from({ length: bucketColumnCount * bucketRowCount }, () => []);

      for (let index = 0; index < particleCount; index += 1) {
        const bucketX = Math.floor(baseX[index] / bucketSize) - bucketMinX;
        const bucketY = Math.floor(baseY[index] / bucketSize) - bucketMinY;

        particleBuckets[bucketY * bucketColumnCount + bucketX]?.push(index);
      }
    };

    const activateParticle = (index: number) => {
      if (activeFlags[index]) return;

      activeFlags[index] = 1;
      activeIndices.push(index);
      particlesSettled = false;
    };

    const activateParticlesInRange = (
      centerX: number,
      centerY: number,
      innerRadius: number,
      outerRadius: number,
    ) => {
      const clampedInnerRadius = Math.max(0, innerRadius);
      const innerRadiusSquared = clampedInnerRadius * clampedInnerRadius;
      const outerRadiusSquared = outerRadius * outerRadius;
      const minBucketX = Math.max(0, Math.floor((centerX - outerRadius) / bucketSize) - bucketMinX);
      const maxBucketX = Math.min(
        bucketColumnCount - 1,
        Math.floor((centerX + outerRadius) / bucketSize) - bucketMinX,
      );
      const minBucketY = Math.max(0, Math.floor((centerY - outerRadius) / bucketSize) - bucketMinY);
      const maxBucketY = Math.min(
        bucketRowCount - 1,
        Math.floor((centerY + outerRadius) / bucketSize) - bucketMinY,
      );

      for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
          const bucket = particleBuckets[bucketY * bucketColumnCount + bucketX];

          for (const index of bucket) {
            const offsetX = baseX[index] - centerX;
            const offsetY = baseY[index] - centerY;
            const distanceSquared = offsetX * offsetX + offsetY * offsetY;

            if (distanceSquared >= innerRadiusSquared && distanceSquared <= outerRadiusSquared) {
              activateParticle(index);
            }
          }
        }
      }
    };

    const injectClickImpulse = (center: Point, radiusValue: number, force: number) => {
      const radiusSquared = radiusValue * radiusValue;
      const minBucketX = Math.max(
        0,
        Math.floor((center.x - radiusValue) / bucketSize) - bucketMinX,
      );
      const maxBucketX = Math.min(
        bucketColumnCount - 1,
        Math.floor((center.x + radiusValue) / bucketSize) - bucketMinX,
      );
      const minBucketY = Math.max(
        0,
        Math.floor((center.y - radiusValue) / bucketSize) - bucketMinY,
      );
      const maxBucketY = Math.min(
        bucketRowCount - 1,
        Math.floor((center.y + radiusValue) / bucketSize) - bucketMinY,
      );

      for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
          const bucket = particleBuckets[bucketY * bucketColumnCount + bucketX];

          for (const index of bucket) {
            const offsetX = baseX[index] - center.x;
            const offsetY = baseY[index] - center.y;
            const distanceSquared = offsetX * offsetX + offsetY * offsetY;

            if (distanceSquared > radiusSquared) continue;

            const distanceValue = Math.sqrt(distanceSquared);
            const directionX =
              distanceValue > 0.001
                ? offsetX / distanceValue
                : Math.cos(vibrance[index] * Math.PI * 2);
            const directionY =
              distanceValue > 0.001
                ? offsetY / distanceValue
                : Math.sin(vibrance[index] * Math.PI * 2);
            const normalizedDistance = distanceValue / radiusValue;
            const falloff = Math.exp(-(normalizedDistance * normalizedDistance) * 1.85);
            const angularNoise = (vibrance[index] - 0.5) * force * falloff * 0.32;
            const impulse = force * falloff;

            activateParticle(index);
            velocityX[index] += directionX * impulse - directionY * angularNoise;
            velocityY[index] += directionY * impulse + directionX * angularNoise;
            positionX[index] += directionX * impulse * 0.34;
            positionY[index] += directionY * impulse * 0.34;
            energy[index] = Math.max(energy[index], clamp(falloff * 0.48, 0, 1));
          }
        }
      }
    };

    const syncDots = () => {
      const dots = buildDots(bufferWidth, bufferHeight, particleGap);

      particleCount = dots.length;
      baseX = new Float32Array(particleCount);
      baseY = new Float32Array(particleCount);
      positionX = new Float32Array(particleCount);
      positionY = new Float32Array(particleCount);
      velocityX = new Float32Array(particleCount);
      velocityY = new Float32Array(particleCount);
      radius = new Float32Array(particleCount);
      opacity = new Float32Array(particleCount);
      vibrance = new Float32Array(particleCount);
      energy = new Float32Array(particleCount);
      renderData = new Float32Array(particleCount * particleRenderStride);
      activeFlags = new Uint8Array(particleCount);
      activeIndices = [];

      for (const [index, dot] of dots.entries()) {
        baseX[index] = dot.x;
        baseY[index] = dot.y;
        positionX[index] = dot.x;
        positionY[index] = dot.y;
        radius[index] = dot.radius;
        opacity[index] = dot.opacity;
        vibrance[index] = dot.vibrance;
      }

      writeParticleData();
      syncParticleBuckets();
      gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, renderData, gl.DYNAMIC_DRAW);
    };

    const resize = () => {
      canvasRect = canvas.getBoundingClientRect();
      const nextCssWidth = Math.max(1, canvasRect.width);
      const nextCssHeight = Math.max(1, canvasRect.height);
      const dpr = Math.min(
        globalThis.window.devicePixelRatio || 1,
        maxDevicePixelRatio,
        Math.max(0.55, Math.sqrt(maxCanvasPixelCount / (nextCssWidth * nextCssHeight))),
      );
      const pixelWidth = Math.max(1, Math.round(nextCssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(nextCssHeight * dpr));
      const nextParticleGap = Math.max(
        dotGap * dpr,
        Math.sqrt((pixelWidth * pixelHeight) / targetParticleGridCells),
      );

      cssWidth = nextCssWidth;
      cssHeight = nextCssHeight;

      if (
        bufferWidth === pixelWidth &&
        bufferHeight === pixelHeight &&
        Math.abs(particleGap - nextParticleGap) < 0.01
      )
        return;

      bufferWidth = pixelWidth;
      bufferHeight = pixelHeight;
      particleGap = nextParticleGap;
      waves = [];
      activeIndices = [];
      activeFlags.fill(0);
      cursorTarget = null;
      cursorPosition = null;
      cursorVelocityX = 0;
      cursorVelocityY = 0;
      cursorStrength = 0;
      isPointerInside = false;
      particlesSettled = true;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      syncDots();
    };

    const settleParticles = () => {
      for (let index = 0; index < particleCount; index += 1) {
        positionX[index] = baseX[index];
        positionY[index] = baseY[index];
        velocityX[index] = 0;
        velocityY[index] = 0;
        energy[index] = 0;
      }

      activeIndices = [];
      activeFlags.fill(0);
      particlesSettled = true;
    };

    const syncCursor = (elapsedMs: number) => {
      const targetStrength = isPointerInside && cursorTarget ? 1 : 0;
      const strengthFollow = 1 - Math.exp((-elapsedMs / 1000) * (targetStrength ? 12 : 5.5));

      cursorStrength = mix(cursorStrength, targetStrength, strengthFollow);

      if (!cursorTarget) {
        const decay = 0.82 ** (elapsedMs / 16.667);

        cursorVelocityX *= decay;
        cursorVelocityY *= decay;
        return cursorStrength > 0.002 || Math.hypot(cursorVelocityX, cursorVelocityY) > 0.02;
      }

      if (!cursorPosition) {
        cursorPosition = { ...cursorTarget };
        cursorVelocityX = 0;
        cursorVelocityY = 0;
        return cursorStrength > 0.002;
      }

      const previousX = cursorPosition.x;
      const previousY = cursorPosition.y;
      const follow = 1 - Math.exp((-elapsedMs / 1000) * 17);
      const nextX = mix(previousX, cursorTarget.x, follow);
      const nextY = mix(previousY, cursorTarget.y, follow);
      const velocityFollow = 1 - Math.exp((-elapsedMs / 1000) * 18);

      cursorVelocityX = mix(
        cursorVelocityX,
        (nextX - previousX) / Math.max(elapsedMs, 1),
        velocityFollow,
      );
      cursorVelocityY = mix(
        cursorVelocityY,
        (nextY - previousY) / Math.max(elapsedMs, 1),
        velocityFollow,
      );
      cursorPosition = {
        x: nextX,
        y: nextY,
      };

      return cursorStrength > 0.002 || Math.hypot(cursorVelocityX, cursorVelocityY) > 0.02;
    };

    const simulateParticles = (now: number) => {
      if (!canAnimateParticles) return false;

      const elapsedMs = lastRenderTime ? clamp(now - lastRenderTime, 8, 34) : 16.667;
      const step = elapsedMs / 16.667;
      const minSide = Math.min(bufferWidth, bufferHeight);
      const diagonal = Math.hypot(bufferWidth, bufferHeight);
      const cursorActive = syncCursor(elapsedMs);
      const cursorRadius = clamp(minSide * 0.066, 42, 96);
      const cursorRadiusSquared = (cursorRadius * 2.35) ** 2;
      const cursorPush = clamp(minSide * 0.00125, 0.72, 1.9);
      const cursorSweep = clamp(minSide * 0.00014, 0.07, 0.24);
      const spring = 0.032;
      const damping = 0.87 ** step;
      const maxDisplacement = clamp(minSide * 0.04, 20, 54);
      const velocityLimit = clamp(minSide * 0.01, 6, 17);
      let maxMotion = 0;

      if (cursorPosition && cursorStrength > 0.002) {
        activateParticlesInRange(cursorPosition.x, cursorPosition.y, 0, cursorRadius * 2.35);
      }

      waves = waves.filter((wave) => now - wave.startedAt <= wave.life);
      const activeWaves: WaveFrame[] = [];

      for (const wave of waves) {
        const age = now - wave.startedAt;
        const frontRadius = age * wave.speed;
        const outerRadius = frontRadius + wave.width * 3.8;
        const innerRadius = Math.max(0, frontRadius - wave.width * 6.6);
        const activationOuterRadius = frontRadius + wave.width * 2.7;
        const activationInnerRadius = Math.max(0, wave.activatedRadius - wave.width * 5.6);

        if (activationOuterRadius > wave.activatedRadius) {
          activateParticlesInRange(wave.x, wave.y, activationInnerRadius, activationOuterRadius);
          wave.activatedRadius = activationOuterRadius;
        }

        activeWaves.push({
          ...wave,
          envelope: (1 - age / wave.life) ** 1.12,
          frontRadius,
          innerRadiusSquared: innerRadius * innerRadius,
          outerRadiusSquared: outerRadius * outerRadius,
        });
      }

      if (particlesSettled && !cursorActive && activeWaves.length === 0) return false;

      let nextActiveCount = 0;
      const activeCount = activeIndices.length;

      for (let activeIndex = 0; activeIndex < activeCount; activeIndex += 1) {
        const index = activeIndices[activeIndex];
        const restoreX = baseX[index] - positionX[index];
        const restoreY = baseY[index] - positionY[index];
        let ax = restoreX * spring;
        let ay = restoreY * spring;
        let localEnergy = 0;

        if (cursorPosition && cursorStrength > 0.002) {
          const offsetX = positionX[index] - cursorPosition.x;
          const offsetY = positionY[index] - cursorPosition.y;
          const distanceSquared = offsetX * offsetX + offsetY * offsetY;

          if (distanceSquared <= cursorRadiusSquared) {
            const distanceValue = Math.sqrt(distanceSquared);
            const directionX =
              distanceValue > 0.001
                ? offsetX / distanceValue
                : Math.cos(vibrance[index] * Math.PI * 2);
            const directionY =
              distanceValue > 0.001
                ? offsetY / distanceValue
                : Math.sin(vibrance[index] * Math.PI * 2);
            const normalizedDistance = distanceValue / cursorRadius;
            const pressure =
              Math.exp(-normalizedDistance * normalizedDistance * 1.38) * cursorStrength;
            const velocityFrameX = cursorVelocityX * 16.667;
            const velocityFrameY = cursorVelocityY * 16.667;
            const cursorSpeed = Math.hypot(velocityFrameX, velocityFrameY);
            const speedPressure = clamp(cursorSpeed / cursorRadius, 0, 1.45);
            const wake =
              Math.exp(-normalizedDistance * normalizedDistance * 0.62) *
              cursorStrength *
              speedPressure;
            const swirl =
              (vibrance[index] - 0.5) * pressure * cursorPush * (0.26 + speedPressure * 0.16);

            ax += directionX * pressure * cursorPush * (1 + speedPressure * 0.34);
            ay += directionY * pressure * cursorPush * (1 + speedPressure * 0.34);
            ax += velocityFrameX * wake * cursorSweep - directionY * swirl;
            ay += velocityFrameY * wake * cursorSweep + directionX * swirl;
            localEnergy += pressure * (0.18 + speedPressure * 0.14);
          }
        }

        for (const wave of activeWaves) {
          const offsetX = positionX[index] - wave.x;
          const offsetY = positionY[index] - wave.y;
          const distanceSquared = offsetX * offsetX + offsetY * offsetY;

          if (
            distanceSquared < wave.innerRadiusSquared ||
            distanceSquared > wave.outerRadiusSquared
          ) {
            continue;
          }

          const distanceValue = Math.sqrt(distanceSquared);
          const directionX =
            distanceValue > 0.001
              ? offsetX / distanceValue
              : Math.cos(vibrance[index] * Math.PI * 2);
          const directionY =
            distanceValue > 0.001
              ? offsetY / distanceValue
              : Math.sin(vibrance[index] * Math.PI * 2);
          const frontDistance = distanceValue - wave.frontRadius;
          const band = Math.exp(-((frontDistance / wave.width) ** 2) * 0.38);
          const pulse = band * wave.envelope;
          const aftershock =
            Math.exp(-(((frontDistance + wave.width * 2.15) / (wave.width * 2.05)) ** 2) * 0.42) *
            wave.envelope;

          ax += directionX * (pulse * wave.force - aftershock * wave.force * 0.12);
          ay += directionY * (pulse * wave.force - aftershock * wave.force * 0.12);
          localEnergy += pulse * 0.24 + aftershock * 0.08;
        }

        velocityX[index] = (velocityX[index] + ax * step) * damping;
        velocityY[index] = (velocityY[index] + ay * step) * damping;

        const speed = Math.hypot(velocityX[index], velocityY[index]);
        const particleEnergy = clamp(energy[index] + localEnergy, 0, 4);
        const particleVelocityLimit = velocityLimit * (1 + particleEnergy * 1.8);

        if (speed > particleVelocityLimit) {
          const velocityScale = particleVelocityLimit / speed;

          velocityX[index] *= velocityScale;
          velocityY[index] *= velocityScale;
        }

        positionX[index] += velocityX[index] * step;
        positionY[index] += velocityY[index] * step;

        const displacementX = positionX[index] - baseX[index];
        const displacementY = positionY[index] - baseY[index];
        const displacement = Math.hypot(displacementX, displacementY);
        const particleMaxDisplacement = maxDisplacement * (1 + particleEnergy * 1.65);

        if (displacement > particleMaxDisplacement) {
          const displacementScale = particleMaxDisplacement / displacement;

          positionX[index] = baseX[index] + displacementX * displacementScale;
          positionY[index] = baseY[index] + displacementY * displacementScale;
          velocityX[index] *= 0.58;
          velocityY[index] *= 0.58;
        }

        const targetEnergy = clamp(
          localEnergy + speed * 0.032 + (displacement / diagonal) * 2.3,
          0,
          1,
        );
        const energyFollow = 1 - (targetEnergy > energy[index] ? 0.7 : 0.88) ** step;

        energy[index] = mix(energy[index], targetEnergy, energyFollow);
        maxMotion = Math.max(maxMotion, speed + displacement * 0.03 + energy[index]);

        if (speed + displacement * 0.04 + energy[index] > 0.012 || localEnergy > 0.001) {
          activeIndices[nextActiveCount] = index;
          nextActiveCount += 1;
        } else {
          positionX[index] = baseX[index];
          positionY[index] = baseY[index];
          velocityX[index] = 0;
          velocityY[index] = 0;
          energy[index] = 0;
          activeFlags[index] = 0;
        }
      }

      activeIndices.length = nextActiveCount;

      if (!cursorActive && waves.length === 0 && activeIndices.length === 0 && maxMotion < 0.018) {
        settleParticles();
        writeParticleData();
        return false;
      }

      writeParticleData();
      particlesSettled = false;
      return cursorActive || waves.length > 0 || activeIndices.length > 0 || maxMotion >= 0.018;
    };

    const render = () => {
      const now = globalThis.performance.now();
      const isActive = simulateParticles(now);
      const color = colors.primary;
      const background = colors.background;

      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(resolutionUniform, bufferWidth, bufferHeight);
      gl.uniform3f(colorUniform, color[0], color[1], color[2]);
      gl.uniform1f(timeUniform, now / 1000);

      if (isActive) {
        gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, renderData);
      }

      gl.drawArraysInstanced(gl.POINTS, 0, 1, particleCount);
      lastRenderTime = now;

      return isActive;
    };

    const animate = () => {
      if (render()) {
        animationFrame = globalThis.requestAnimationFrame(animate);
      } else {
        animationFrame = 0;
      }
    };

    const queueRender = () => {
      if (animationFrame) return;

      animationFrame = globalThis.requestAnimationFrame(animate);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!canTrackCursor || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;

      let shouldRender = false;
      const pointerEvents = event.getCoalescedEvents();

      for (const pointerEvent of pointerEvents.length ? pointerEvents : [event]) {
        const clientPoint = {
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
        };
        const canvasPoint = toCanvasPoint(clientPoint, true);

        if (canvasPoint) {
          cursorTarget = canvasPoint;
          isPointerInside = true;
          shouldRender = true;
        } else {
          cursorTarget = toCanvasPoint(clientPoint, false);

          if (isPointerInside || cursorStrength > 0.01) shouldRender = true;

          isPointerInside = false;
        }
      }

      if (shouldRender) queueRender();
    };

    const handlePointerRawUpdate = (event: Event) => {
      if (event instanceof PointerEvent) handlePointerMove(event);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!canAnimateParticles || !event.isPrimary) return;

      const canvasPoint = toCanvasPoint(
        {
          x: event.clientX,
          y: event.clientY,
        },
        true,
      );

      if (!canvasPoint) return;

      const now = globalThis.performance.now();
      const unit = Math.min(bufferWidth, bufferHeight) / 10;
      const diagonal = Math.hypot(bufferWidth, bufferHeight);
      const speed = clamp(unit * 0.008, 0.5, 1);
      const width = clamp(unit * 0.58, 48, 120);
      const force = clamp(unit * 0.052, 3.6, 9.6);
      const impulseRadius = clamp(width * 1.28, 62, 190);
      const impulseForce = clamp(force * 1.42, 5.2, 16);
      const previousWaves = waves.filter((wave) => now - wave.startedAt <= wave.life);

      if (canTrackCursor && (event.pointerType === "mouse" || event.pointerType === "pen")) {
        cursorTarget = canvasPoint;
        isPointerInside = true;
      }

      particlesSettled = false;
      injectClickImpulse(canvasPoint, impulseRadius, impulseForce);
      waves = [
        ...previousWaves,
        {
          ...canvasPoint,
          activatedRadius: 0,
          force,
          life: diagonal / speed + 780,
          speed,
          startedAt: now,
          width,
        },
      ].slice(-maxWaveCount);
      queueRender();
    };

    const handlePointerLeave = () => {
      isPointerInside = false;
      queueRender();
    };

    const handleWindowBlur = () => {
      isPointerInside = false;
      queueRender();
    };

    resize();
    render();

    const handleLayoutChange = () => {
      resize();
      queueRender();
    };
    const resizeObserver = new ResizeObserver(handleLayoutChange);
    resizeObserver.observe(canvas);
    const mutationObserver = new MutationObserver(() => {
      refreshColors();
      queueRender();
    });
    mutationObserver.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    if (canTrackCursor) {
      globalThis.window.addEventListener("pointermove", handlePointerMove, { passive: true });
      canvas.addEventListener("pointerrawupdate", handlePointerRawUpdate, { passive: true });
      canvas.addEventListener("pointerleave", handlePointerLeave, { passive: true });
      globalThis.window.addEventListener("blur", handleWindowBlur);
    }

    if (canAnimateParticles) {
      canvas.addEventListener("pointerdown", handlePointerDown, { passive: true });
    }

    return () => {
      if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();

      if (canTrackCursor) {
        globalThis.window.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerrawupdate", handlePointerRawUpdate);
        canvas.removeEventListener("pointerleave", handlePointerLeave);
        globalThis.window.removeEventListener("blur", handleWindowBlur);
      }

      if (canAnimateParticles) {
        canvas.removeEventListener("pointerdown", handlePointerDown);
      }

      gl.deleteBuffer(particleBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas aria-hidden className="block size-full bg-background" ref={canvasRef} />;
};
