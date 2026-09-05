"use client";

import { Brand } from "@quieter/ui/brand";
import { brand } from "@quieter/ui/brand-geometry";
import { useEffect, useRef } from "react";
import {
  compute,
  draw,
  frame,
  init,
  pingPongStorage,
  storage,
  surface,
} from "vgpu";
import type { Surface } from "vgpu";

const dotGap = 4;
const maxCanvasPixelCount = 2_200_000;
const maxDevicePixelRatio = 1.5;
const maxWaveCount = 24;
const maxImpulseCount = maxWaveCount;
const maxParticleCount = 108_000;
const particleStride = 6;
const targetParticleGridCells = 54_000;
const workgroupSize = 128;

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
  activationInnerRadiusSquared: number;
  activationOuterRadiusSquared: number;
  envelope: number;
  frontRadius: number;
  innerRadiusSquared: number;
  outerRadiusSquared: number;
};

type Impulse = Point & {
  force: number;
  radius: number;
};

type Colors = {
  background: Rgb;
  primary: Rgb;
};

const updateShaderSource = `
const MAX_WAVES = ${maxWaveCount}u;
const MAX_IMPULSES = ${maxImpulseCount}u;
const PI2 = 6.283185307179586;

struct ParticleStatic {
  base: vec2f,
  radius: f32,
  opacity: f32,
  vibrance: f32,
  padding: f32,
}

struct ParticleState {
  position: vec2f,
  velocity: vec2f,
  energy: f32,
  activeFlag: f32,
}

struct Wave {
  center: vec2f,
  force: f32,
  envelope: f32,
  frontRadius: f32,
  width: f32,
  innerRadiusSquared: f32,
  outerRadiusSquared: f32,
  activationInnerRadiusSquared: f32,
  activationOuterRadiusSquared: f32,
}

struct Impulse {
  center: vec2f,
  radius: f32,
  force: f32,
}

struct SimParams {
  step: f32,
  spring: f32,
  damping: f32,
  diagonal: f32,
  cursor: vec2f,
  cursorVelocity: vec2f,
  cursorRadius: f32,
  cursorRadiusSquared: f32,
  cursorActivationRadiusSquared: f32,
  cursorPush: f32,
  cursorSweep: f32,
  cursorStrength: f32,
  particleCount: u32,
  waveCount: u32,
  impulseCount: u32,
}

@group(0) @binding(0) var<storage, read> particleStatics: array<ParticleStatic>;
@group(0) @binding(1) var<storage, read> sourceStates: array<ParticleState>;
@group(0) @binding(2) var<storage, read_write> destinationStates: array<ParticleState>;
@group(0) @binding(3) var<storage, read> waves: array<Wave>;
@group(0) @binding(4) var<storage, read> impulses: array<Impulse>;
@group(0) @binding(5) var<uniform> params: SimParams;

fn directionFor(offset: vec2f, distanceValue: f32, vibrance: f32) -> vec2f {
  if (distanceValue > 0.001) {
    return offset / distanceValue;
  }
  return vec2f(cos(vibrance * PI2), sin(vibrance * PI2));
}

@compute @workgroup_size(${workgroupSize})
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }

  let particle = particleStatics[index];
  let source = sourceStates[index];
  var position = source.position;
  var velocity = source.velocity;
  var energy = source.energy;
  var nextActive = source.activeFlag;

  if (params.cursorStrength > 0.002) {
    let offset = particle.base - params.cursor;
    if (dot(offset, offset) <= params.cursorActivationRadiusSquared) {
      nextActive = 1.0;
    }
  }

  for (var waveIndex = 0u; waveIndex < MAX_WAVES; waveIndex += 1u) {
    if (waveIndex >= params.waveCount) {
      break;
    }
    let wave = waves[waveIndex];
    let offset = particle.base - wave.center;
    let distanceSquared = dot(offset, offset);
    if (
      distanceSquared >= wave.activationInnerRadiusSquared &&
      distanceSquared <= wave.activationOuterRadiusSquared
    ) {
      nextActive = 1.0;
    }
  }

  for (var impulseIndex = 0u; impulseIndex < MAX_IMPULSES; impulseIndex += 1u) {
    if (impulseIndex >= params.impulseCount) {
      break;
    }
    let impulseData = impulses[impulseIndex];
    let offset = particle.base - impulseData.center;
    let distanceSquared = dot(offset, offset);
    if (distanceSquared > impulseData.radius * impulseData.radius) {
      continue;
    }
    let distanceValue = sqrt(distanceSquared);
    let direction = directionFor(offset, distanceValue, particle.vibrance);
    let normalizedDistance = distanceValue / impulseData.radius;
    let falloff = exp(-(normalizedDistance * normalizedDistance) * 1.85);
    let angularNoise = (particle.vibrance - 0.5) * impulseData.force * falloff * 0.32;
    let impulseForce = impulseData.force * falloff;
    nextActive = 1.0;
    velocity += vec2f(
      direction.x * impulseForce - direction.y * angularNoise,
      direction.y * impulseForce + direction.x * angularNoise
    );
    position += direction * impulseForce * 0.34;
    energy += falloff * 0.48;
  }

  if (nextActive < 0.5) {
    destinationStates[index] = ParticleState(particle.base, vec2f(0.0), 0.0, 0.0);
    return;
  }

  let restore = particle.base - position;
  var acceleration = restore * params.spring;
  var localEnergy = 0.0;

  if (params.cursorStrength > 0.002) {
    let offset = position - params.cursor;
    let distanceSquared = dot(offset, offset);
    if (distanceSquared <= params.cursorRadiusSquared) {
      let distanceValue = sqrt(distanceSquared);
      let direction = directionFor(offset, distanceValue, particle.vibrance);
      let normalizedDistance = distanceValue / params.cursorRadius;
      let pressure = exp(-normalizedDistance * normalizedDistance * 1.38) * params.cursorStrength;
      let cursorSpeed = length(params.cursorVelocity);
      let speedPressure = clamp(cursorSpeed / params.cursorRadius, 0.0, 1.45);
      let wake = exp(-normalizedDistance * normalizedDistance * 0.62) * params.cursorStrength * speedPressure;
      let swirl = (particle.vibrance - 0.5) * pressure * params.cursorPush * (0.26 + speedPressure * 0.16);
      acceleration += direction * pressure * params.cursorPush * (1.0 + speedPressure * 0.34);
      acceleration += vec2f(
        params.cursorVelocity.x * wake * params.cursorSweep - direction.y * swirl,
        params.cursorVelocity.y * wake * params.cursorSweep + direction.x * swirl
      );
      localEnergy += pressure * (0.18 + speedPressure * 0.14);
    }
  }

  for (var waveIndex = 0u; waveIndex < MAX_WAVES; waveIndex += 1u) {
    if (waveIndex >= params.waveCount) {
      break;
    }
    let wave = waves[waveIndex];
    let offset = position - wave.center;
    let distanceSquared = dot(offset, offset);
    if (distanceSquared < wave.innerRadiusSquared || distanceSquared > wave.outerRadiusSquared) {
      continue;
    }
    let distanceValue = sqrt(distanceSquared);
    let direction = directionFor(offset, distanceValue, particle.vibrance);
    let frontDistance = distanceValue - wave.frontRadius;
    let normalizedBand = frontDistance / wave.width;
    let band = exp(-(normalizedBand * normalizedBand) * 0.38);
    let pulse = band * wave.envelope;
    let aftershockOffset = (frontDistance + wave.width * 2.15) / (wave.width * 2.05);
    let aftershock = exp(-(aftershockOffset * aftershockOffset) * 0.42) * wave.envelope;
    acceleration += direction * (pulse * wave.force - aftershock * wave.force * 0.12);
    localEnergy += pulse * 0.24 + aftershock * 0.08;
  }

  velocity = (velocity + acceleration * params.step) * params.damping;
  let speed = length(velocity);
  position += velocity * params.step;
  let displacement = length(position - particle.base);
  let targetEnergy = max(localEnergy + speed * 0.032 + displacement / params.diagonal * 2.3, 0.0);
  let followBase = select(0.93, 0.7, targetEnergy > energy);
  let energyFollow = 1.0 - pow(followBase, params.step);
  energy = mix(energy, targetEnergy, energyFollow);

  if (speed + displacement * 0.04 + energy > 0.012 || localEnergy > 0.001) {
    destinationStates[index] = ParticleState(position, velocity, energy, 1.0);
  } else {
    destinationStates[index] = ParticleState(particle.base, vec2f(0.0), 0.0, 0.0);
  }
}
`;

const renderShaderSource = `
struct ParticleStatic {
  base: vec2f,
  radius: f32,
  opacity: f32,
  vibrance: f32,
  padding: f32,
}

struct ParticleState {
  position: vec2f,
  velocity: vec2f,
  energy: f32,
  activeFlag: f32,
}

struct RenderParams {
  resolution: vec2f,
  color: vec3f,
  time: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) localPosition: vec2f,
  @location(1) opacity: f32,
  @location(2) radius: f32,
  @location(3) vibrance: f32,
  @location(4) energy: f32,
}

@group(0) @binding(0) var<storage, read> particleStatics: array<ParticleStatic>;
@group(0) @binding(1) var<storage, read> particleStates: array<ParticleState>;
@group(0) @binding(2) var<uniform> params: RenderParams;

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let particle = particleStatics[instanceIndex];
  let state = particleStates[instanceIndex];
  let energy = clamp(state.energy, 0.0, 1.0);
  let shimmer = smoothstep(0.72, 1.0, particle.vibrance) * 0.12;
  let radius = particle.radius + energy * 0.12 + shimmer;
  let halfSize = radius + 0.72;
  let localPosition = corners[vertexIndex] * halfSize;
  let center = vec2f(
    state.position.x / params.resolution.x * 2.0 - 1.0,
    1.0 - state.position.y / params.resolution.y * 2.0
  );
  let clipOffset = vec2f(
    localPosition.x / params.resolution.x * 2.0,
    -localPosition.y / params.resolution.y * 2.0
  );
  var output: VertexOutput;
  output.position = vec4f(center + clipOffset, 0.0, 1.0);
  output.localPosition = localPosition;
  output.opacity = particle.opacity;
  output.radius = radius;
  output.vibrance = particle.vibrance;
  output.energy = energy;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let distanceValue = length(input.localPosition);
  let core = 1.0 - smoothstep(max(input.radius - 0.72, 0.0), input.radius + 0.78, distanceValue);
  let shimmerSeed = smoothstep(0.68, 1.0, input.vibrance);
  let shimmer = (sin(params.time * mix(1.2, 2.8, input.vibrance) + input.vibrance * 41.0) * 0.5 + 0.5) * shimmerSeed;
  let alpha = min(core * input.opacity * (0.94 + shimmer * 0.1 + input.energy * 0.08), 1.0);
  return vec4f(params.color, alpha);
}
`;

const fract = (value: number) => value - Math.floor(value);

const hash = (x: number, y: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7) * 43_758.5453123);

const mix = (start: number, end: number, amount: number) =>
  start * (1 - amount) + end * amount;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const oklchGrayToSrgb = (lightness: number) => {
  const linear = lightness ** 3;
  return linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055;
};

const getCssColor = (
  element: HTMLElement,
  property: string,
  fallback: Rgb
): Rgb => {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  const oklchMatch = /^oklch\(\s*(?<lightness>[\d.]+)(?<percent>%)?/u.exec(
    value
  );
  if (oklchMatch) {
    const percent = oklchMatch.groups?.percent;
    const lightness =
      Number(oklchMatch.groups?.lightness) /
      (percent === undefined || percent === "" ? 1 : 100);
    const channel = oklchGrayToSrgb(lightness);
    return [channel, channel, channel];
  }

  const rgbMatch =
    /rgba?\(\s*(?<red>[\d.]+)[,\s]+(?<green>[\d.]+)[,\s]+(?<blue>[\d.]+)/u.exec(
      value
    );
  if (rgbMatch) {
    return [
      Number(rgbMatch.groups?.red) / 255,
      Number(rgbMatch.groups?.green) / 255,
      Number(rgbMatch.groups?.blue) / 255,
    ];
  }

  const srgbMatch =
    /^color\(\s*srgb\s+(?<red>[\d.]+)\s+(?<green>[\d.]+)\s+(?<blue>[\d.]+)/u.exec(
      value
    );
  if (srgbMatch) {
    return [
      Number(srgbMatch.groups?.red),
      Number(srgbMatch.groups?.green),
      Number(srgbMatch.groups?.blue),
    ];
  }
  return fallback;
};

const readColors = (canvas: HTMLCanvasElement): Colors => ({
  background: getCssColor(canvas, "--brand-bg", [14 / 255, 15 / 255, 16 / 255]),
  primary: getCssColor(canvas, "--primary", [0.25, 0.25, 0.25]),
});

const buildDots = (width: number, height: number, gap: number) => {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const context = mask.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }
  const scale = (Math.min(width, height) * 0.65) / brand.mark.width;
  context.translate(width / 2 - 500 * scale, height / 2 - 500 * scale);
  context.scale(scale, scale);
  const outline = new Path2D(brand.mark.path);
  // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- CanvasRenderingContext2D.fill takes a Path2D, not an array value.
  context.fill(outline);
  const pixels = context.getImageData(0, 0, width, height).data;
  const dots: Dot[] = [];
  const columns = Math.ceil(width / gap);
  const rows = Math.ceil(height / gap);
  for (let cellY = 0; cellY < rows; cellY += 1) {
    for (let cellX = 0; cellX < columns; cellX += 1) {
      const x = (cellX + 0.5 + (hash(cellX, cellY) - 0.5) * 0.3) * gap;
      const y = (cellY + 0.5 + (hash(cellY, cellX + 19) - 0.5) * 0.3) * gap;
      if (x >= width || y >= height) {
        continue;
      }
      const coverage =
        (pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] ?? 0) / 255;
      const seed = hash(cellX + 389, cellY + 389);
      if (coverage < 0.1 && seed > 0.22) {
        continue;
      }
      dots.push({
        opacity: coverage > 0.1 ? (0.6 + seed * 0.4) * coverage : 0.12,
        radius:
          gap * (coverage > 0.1 ? 0.29 + seed * 0.08 : 0.09 + seed * 0.04),
        vibrance: hash(cellX + 941, cellY + 941),
        x,
        y,
      });
    }
  }
  return dots.slice(0, maxParticleCount);
};

export const AuthVisual = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    canvas.style.visibility = "visible";
    let dispose: (() => void) | undefined;

    const initialize = async () => {
      const gpu = await init({ powerPreference: "high-performance" });
      if (cancelled) {
        gpu.dispose();
        return;
      }
      dispose = () => {
        gpu.dispose();
      };

      let animationFrame = 0;
      let bufferWidth = 1;
      let bufferHeight = 1;
      let cssWidth = 1;
      let cssHeight = 1;
      let particleGap = dotGap;
      let particleCount = 0;
      let canvasRect = canvas.getBoundingClientRect();
      let waves: Wave[] = [];
      let pendingImpulses: Impulse[] = [];
      let cursorTarget: Point | null = null;
      let cursorPosition: Point | null = null;
      let cursorVelocityX = 0;
      let cursorVelocityY = 0;
      let cursorStrength = 0;
      let isPointerInside = false;
      let lastRenderTime = 0;
      let particlesSettled = true;
      let settleUntil = 0;
      let colors = readColors(canvas);
      const canAnimateParticles = !globalThis.window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const canTrackCursor =
        canAnimateParticles &&
        globalThis.window.matchMedia("(hover: hover) and (pointer: fine)")
          .matches;
      const particleBytes =
        maxParticleCount * particleStride * Float32Array.BYTES_PER_ELEMENT;
      const particleStatics = storage(gpu, particleBytes, "read");
      const particleStates = pingPongStorage(gpu, particleBytes);
      const waveData = new Float32Array(maxWaveCount * 10);
      const impulseData = new Float32Array(maxImpulseCount * 4);
      const waveStorage = storage(gpu, waveData.byteLength, "read");
      const impulseStorage = storage(gpu, impulseData.byteLength, "read");
      let canvasSurface: Surface | undefined;

      const syncDots = () => {
        const dots = buildDots(bufferWidth, bufferHeight, particleGap);
        const staticData = new Float32Array(dots.length * particleStride);
        const stateData = new Float32Array(dots.length * particleStride);
        particleCount = dots.length;
        for (const [index, dot] of dots.entries()) {
          const offset = index * particleStride;
          staticData[offset] = dot.x;
          staticData[offset + 1] = dot.y;
          staticData[offset + 2] = dot.radius;
          staticData[offset + 3] = dot.opacity;
          staticData[offset + 4] = dot.vibrance;
          stateData[offset] = dot.x;
          stateData[offset + 1] = dot.y;
        }
        particleStatics.write(staticData);
        particleStates.read.write(stateData);
        particleStates.write.write(stateData);
      };

      const resize = () => {
        canvasRect = canvas.getBoundingClientRect();
        const nextCssWidth = Math.max(1, canvasRect.width);
        const nextCssHeight = Math.max(1, canvasRect.height);
        const dpr = Math.min(
          globalThis.window.devicePixelRatio || 1,
          maxDevicePixelRatio,
          Math.max(
            0.55,
            Math.sqrt(maxCanvasPixelCount / (nextCssWidth * nextCssHeight))
          )
        );
        const pixelWidth = Math.max(1, Math.round(nextCssWidth * dpr));
        const pixelHeight = Math.max(1, Math.round(nextCssHeight * dpr));
        const nextParticleGap = Math.max(
          dotGap * dpr,
          Math.sqrt((pixelWidth * pixelHeight) / targetParticleGridCells)
        );
        cssWidth = nextCssWidth;
        cssHeight = nextCssHeight;
        if (
          bufferWidth === pixelWidth &&
          bufferHeight === pixelHeight &&
          Math.abs(particleGap - nextParticleGap) < 0.01
        ) {
          return false;
        }
        bufferWidth = pixelWidth;
        bufferHeight = pixelHeight;
        particleGap = nextParticleGap;
        waves = [];
        pendingImpulses = [];
        cursorTarget = null;
        cursorPosition = null;
        cursorVelocityX = 0;
        cursorVelocityY = 0;
        cursorStrength = 0;
        isPointerInside = false;
        particlesSettled = true;
        settleUntil = 0;
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        if (canvasSurface) {
          canvasSurface.dispose();
          canvasSurface = surface(gpu, canvas, {
            autoResize: false,
            size: [pixelWidth, pixelHeight],
          });
        }
        syncDots();
        return true;
      };

      resize();
      canvasSurface = surface(gpu, canvas, {
        autoResize: false,
        size: [bufferWidth, bufferHeight],
      });
      const simulation = compute(gpu, updateShaderSource, {
        label: "auth-visual-simulation",
      });
      const particles = draw(gpu, {
        blend: {
          alpha: { dst: "one-minus-src-alpha", src: "one" },
          color: { dst: "one-minus-src-alpha", src: "src-alpha" },
        },
        instances: particleCount,
        label: "auth-visual-particles",
        shader: renderShaderSource,
        vertices: 6,
      });
      let compilation: ReturnType<typeof particles.compile> | undefined;
      frame(gpu, () => {
        compilation = particles.compile(canvasSurface);
      });
      if (!compilation) {
        throw new Error("Failed to start the auth visual pipeline compilation");
      }
      await compilation;
      if (cancelled) {
        gpu.dispose();
        return;
      }

      const toCanvasPoint = (clientPoint: Point, requireInside: boolean) => {
        const xCss = clientPoint.x - canvasRect.left;
        const yCss = clientPoint.y - canvasRect.top;
        const isInside =
          xCss >= 0 && xCss <= cssWidth && yCss >= 0 && yCss <= cssHeight;
        if (requireInside && !isInside) {
          return null;
        }
        return {
          x: (xCss * bufferWidth) / cssWidth,
          y: (yCss * bufferHeight) / cssHeight,
        };
      };

      const syncCursor = (elapsedMs: number) => {
        const targetStrength = isPointerInside && cursorTarget ? 1 : 0;
        const strengthFollow =
          1 - Math.exp((-elapsedMs / 1000) * (targetStrength ? 12 : 5.5));
        cursorStrength = mix(cursorStrength, targetStrength, strengthFollow);
        if (!cursorTarget) {
          const decay = 0.82 ** (elapsedMs / 16.667);
          cursorVelocityX *= decay;
          cursorVelocityY *= decay;
          return (
            cursorStrength > 0.002 ||
            Math.hypot(cursorVelocityX, cursorVelocityY) > 0.02
          );
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
          velocityFollow
        );
        cursorVelocityY = mix(
          cursorVelocityY,
          (nextY - previousY) / Math.max(elapsedMs, 1),
          velocityFollow
        );
        cursorPosition = { x: nextX, y: nextY };
        return (
          cursorStrength > 0.002 ||
          Math.hypot(cursorVelocityX, cursorVelocityY) > 0.02
        );
      };

      const runGpuSimulation = (
        elapsedMs: number,
        activeWaves: WaveFrame[],
        impulses: Impulse[]
      ) => {
        waveData.fill(0);
        for (const [index, wave] of activeWaves.entries()) {
          const offset = index * 10;
          waveData.set(
            [
              wave.x,
              wave.y,
              wave.force,
              wave.envelope,
              wave.frontRadius,
              wave.width,
              wave.innerRadiusSquared,
              wave.outerRadiusSquared,
              wave.activationInnerRadiusSquared,
              wave.activationOuterRadiusSquared,
            ],
            offset
          );
        }
        impulseData.fill(0);
        for (const [index, impulse] of impulses.entries()) {
          impulseData.set(
            [impulse.x, impulse.y, impulse.radius, impulse.force],
            index * 4
          );
        }
        waveStorage.write(waveData);
        impulseStorage.write(impulseData);
        const step = elapsedMs / 16.667;
        const minSide = Math.min(bufferWidth, bufferHeight);
        const cursorRadius = clamp(minSide * 0.066, 42, 96);
        const cursorActivationRadius = cursorRadius * 2.35;
        simulation.set({
          destinationStates: particleStates.write,
          impulses: impulseStorage,
          params: {
            cursor: [cursorPosition?.x ?? 0, cursorPosition?.y ?? 0],
            cursorActivationRadiusSquared:
              cursorActivationRadius * cursorActivationRadius,
            cursorPush: clamp(minSide * 0.00125, 0.72, 1.9),
            cursorRadius,
            cursorRadiusSquared:
              cursorActivationRadius * cursorActivationRadius,
            cursorStrength,
            cursorSweep: clamp(minSide * 0.00014, 0.07, 0.24),
            cursorVelocity: [
              cursorVelocityX * 16.667,
              cursorVelocityY * 16.667,
            ],
            damping: 0.87 ** step,
            diagonal: Math.hypot(bufferWidth, bufferHeight),
            impulseCount: impulses.length,
            particleCount,
            spring: 0.032,
            step,
            waveCount: activeWaves.length,
          },
          particleStatics,
          sourceStates: particleStates.read,
          waves: waveStorage,
        });
        simulation.dispatch(Math.ceil(particleCount / workgroupSize));
        particleStates.swap();
      };

      const simulateParticles = (now: number) => {
        if (!canAnimateParticles) {
          return false;
        }
        const elapsedMs = lastRenderTime
          ? clamp(now - lastRenderTime, 8, 34)
          : 16.667;
        const cursorMoving = syncCursor(elapsedMs);
        const cursorActive = !!cursorPosition && cursorStrength > 0.002;
        const impulses = pendingImpulses.slice(-maxImpulseCount);
        const activeWaves: WaveFrame[] = [];
        waves = waves.filter((wave) => now - wave.startedAt <= wave.life);
        for (const wave of waves) {
          const age = now - wave.startedAt;
          const frontRadius = age * wave.speed;
          const outerRadius = frontRadius + wave.width * 3.8;
          const innerRadius = Math.max(0, frontRadius - wave.width * 6.6);
          const activationOuterRadius = frontRadius + wave.width * 2.7;
          const activationInnerRadius = Math.max(
            0,
            wave.activatedRadius - wave.width * 5.6
          );
          if (activationOuterRadius > wave.activatedRadius) {
            wave.activatedRadius = activationOuterRadius;
          }
          activeWaves.push({
            ...wave,
            activationInnerRadiusSquared:
              activationInnerRadius * activationInnerRadius,
            activationOuterRadiusSquared:
              activationOuterRadius * activationOuterRadius,
            envelope: (1 - age / wave.life) ** 1.12,
            frontRadius,
            innerRadiusSquared: innerRadius * innerRadius,
            outerRadiusSquared: outerRadius * outerRadius,
          });
        }
        if (cursorActive || activeWaves.length > 0 || impulses.length > 0) {
          settleUntil = Math.max(settleUntil, now + 2200);
        }
        if (
          particlesSettled &&
          !cursorActive &&
          activeWaves.length === 0 &&
          impulses.length === 0
        ) {
          return false;
        }
        if (
          !cursorActive &&
          activeWaves.length === 0 &&
          impulses.length === 0 &&
          now >= settleUntil
        ) {
          particlesSettled = true;
          return false;
        }
        runGpuSimulation(elapsedMs, activeWaves, impulses);
        pendingImpulses = [];
        const shouldContinue =
          cursorMoving || waves.length > 0 || now < settleUntil;
        particlesSettled = !shouldContinue;
        return shouldContinue;
      };

      const render = () => {
        const renderSurface = canvasSurface;
        if (!renderSurface) {
          return false;
        }
        const now = globalThis.performance.now();
        const isActive = simulateParticles(now);
        particles.set({
          params: {
            color: colors.primary,
            resolution: [bufferWidth, bufferHeight],
            time: now / 1000,
          },
          particleStates: particleStates.read,
          particleStatics,
        });
        frame(gpu, (currentFrame) => {
          currentFrame.pass(
            {
              clear: [...colors.background, 1],
              target: renderSurface,
            },
            (pass) => {
              pass.draw(particles, { instances: particleCount, vertices: 6 });
            }
          );
        });
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
        if (!animationFrame) {
          animationFrame = globalThis.requestAnimationFrame(animate);
        }
      };
      const handlePointerMove = (event: PointerEvent) => {
        if (
          !canTrackCursor ||
          (event.pointerType !== "mouse" && event.pointerType !== "pen")
        ) {
          return;
        }
        let shouldRender = false;
        const coalescedEvents = event.getCoalescedEvents();
        for (const pointerEvent of coalescedEvents.length
          ? coalescedEvents
          : [event]) {
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
            shouldRender = isPointerInside || cursorStrength > 0.01;
            isPointerInside = false;
          }
        }
        if (shouldRender) {
          queueRender();
        }
      };
      const handlePointerRawUpdate = (event: Event) => {
        if (event instanceof PointerEvent) {
          handlePointerMove(event);
        }
      };
      const handlePointerDown = (event: PointerEvent) => {
        if (!canAnimateParticles || !event.isPrimary) {
          return;
        }
        const canvasPoint = toCanvasPoint(
          { x: event.clientX, y: event.clientY },
          true
        );
        if (!canvasPoint) {
          return;
        }
        const now = globalThis.performance.now();
        const unit = Math.min(bufferWidth, bufferHeight) / 10;
        const diagonal = Math.hypot(bufferWidth, bufferHeight);
        const speed = clamp(unit * 0.008, 0.5, 1);
        const width = clamp(unit * 0.58, 48, 120);
        const force = clamp(unit * 0.044, 3.1, 8.2);
        if (
          canTrackCursor &&
          (event.pointerType === "mouse" || event.pointerType === "pen")
        ) {
          cursorTarget = canvasPoint;
          isPointerInside = true;
        }
        particlesSettled = false;
        pendingImpulses = [
          ...pendingImpulses,
          {
            ...canvasPoint,
            force: clamp(force * 1.24, 4.4, 13.5),
            radius: clamp(width * 1.28, 62, 190),
          },
        ].slice(-maxImpulseCount);
        waves = [
          ...waves.filter((wave) => now - wave.startedAt <= wave.life),
          {
            ...canvasPoint,
            activatedRadius: 0,
            force: clamp(unit * 0.037, 2.6, 7),
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
      const handleLayoutChange = () => {
        resize();
        queueRender();
      };

      render();
      const resizeObserver = new ResizeObserver(handleLayoutChange);
      resizeObserver.observe(canvas);
      const mutationObserver = new MutationObserver(() => {
        colors = readColors(canvas);
        queueRender();
      });
      mutationObserver.observe(document.documentElement, {
        attributeFilter: ["class", "style", "data-theme", "data-kb-theme"],
        attributes: true,
      });
      if (canTrackCursor) {
        globalThis.window.addEventListener("pointermove", handlePointerMove, {
          passive: true,
        });
        canvas.addEventListener("pointerrawupdate", handlePointerRawUpdate, {
          passive: true,
        });
        canvas.addEventListener("pointerleave", handlePointerLeave, {
          passive: true,
        });
        globalThis.window.addEventListener("blur", handleWindowBlur);
      }
      if (canAnimateParticles) {
        canvas.addEventListener("pointerdown", handlePointerDown, {
          passive: true,
        });
      }

      dispose = () => {
        if (animationFrame) {
          globalThis.cancelAnimationFrame(animationFrame);
        }
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        if (canTrackCursor) {
          globalThis.window.removeEventListener(
            "pointermove",
            handlePointerMove
          );
          canvas.removeEventListener(
            "pointerrawupdate",
            handlePointerRawUpdate
          );
          canvas.removeEventListener("pointerleave", handlePointerLeave);
          globalThis.window.removeEventListener("blur", handleWindowBlur);
        }
        if (canAnimateParticles) {
          canvas.removeEventListener("pointerdown", handlePointerDown);
        }
        canvasSurface?.dispose();
        gpu.dispose();
      };
    };

    const start = async () => {
      try {
        await initialize();
      } catch {
        dispose?.();
        dispose = undefined;
        if (!cancelled) {
          canvas.style.visibility = "hidden";
        }
        // The SVG underneath remains visible when WebGPU is unavailable.
      }
    };

    void start();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="relative size-full overflow-hidden bg-brand-bg text-primary"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Brand style={{ height: "65%", width: "65%" }} />
      </div>
      <canvas
        className="absolute inset-0 block size-full"
        ref={canvasRef}
        tabIndex={-1}
      />
    </div>
  );
};
