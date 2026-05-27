"use client";

import { useEffect, useRef } from "react";

const dotGap = 4;
const maxCanvasPixelCount = 2_200_000;
const maxDevicePixelRatio = 1.5;
const maxWaveCount = 24;
const maxImpulseCount = maxWaveCount;
const particleStaticStride = 5;
const particleStaticStrideBytes = particleStaticStride * Float32Array.BYTES_PER_ELEMENT;
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

type GpuBufferSet = {
  active: WebGLBuffer;
  energy: WebGLBuffer;
  position: WebGLBuffer;
  velocity: WebGLBuffer;
};

const renderVertexShaderSource = `#version 300 es
in vec2 aPosition;
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
  gl_Position = vec4(aPosition.x / uResolution.x * 2.0 - 1.0, 1.0 - aPosition.y / uResolution.y * 2.0, 0.0, 1.0);
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

const updateVertexShaderSource = `#version 300 es
#define MAX_WAVES ${maxWaveCount}
#define MAX_IMPULSES ${maxImpulseCount}

in vec2 aBase;
in vec2 aPosition;
in vec2 aVelocity;
in float aVibrance;
in float aEnergy;
in float aActive;

out vec2 vNextPosition;
out vec2 vNextVelocity;
out float vNextEnergy;
out float vNextActive;

uniform float uStep;
uniform float uSpring;
uniform float uDamping;
uniform float uDiagonal;

uniform float uCursorActive;
uniform vec2 uCursor;
uniform vec2 uCursorVelocity;
uniform float uCursorRadius;
uniform float uCursorRadiusSquared;
uniform float uCursorActivationRadiusSquared;
uniform float uCursorPush;
uniform float uCursorSweep;
uniform float uCursorStrength;

uniform int uWaveCount;
uniform vec2 uWaveCenter[MAX_WAVES];
uniform float uWaveForce[MAX_WAVES];
uniform float uWaveEnvelope[MAX_WAVES];
uniform float uWaveFrontRadius[MAX_WAVES];
uniform float uWaveWidth[MAX_WAVES];
uniform float uWaveInnerRadiusSquared[MAX_WAVES];
uniform float uWaveOuterRadiusSquared[MAX_WAVES];
uniform float uWaveActivationInnerRadiusSquared[MAX_WAVES];
uniform float uWaveActivationOuterRadiusSquared[MAX_WAVES];

uniform int uImpulseCount;
uniform vec2 uImpulseCenter[MAX_IMPULSES];
uniform float uImpulseRadius[MAX_IMPULSES];
uniform float uImpulseRadiusSquared[MAX_IMPULSES];
uniform float uImpulseForce[MAX_IMPULSES];

const float pi2 = 6.283185307179586;

vec2 directionFor(vec2 offset, float distanceValue, float vibrance) {
  if (distanceValue > 0.001) {
    return offset / distanceValue;
  }

  return vec2(cos(vibrance * pi2), sin(vibrance * pi2));
}

void main() {
  gl_Position = vec4(0.0);
  gl_PointSize = 1.0;

  vec2 position = aPosition;
  vec2 velocity = aVelocity;
  float energy = aEnergy;
  float nextActive = aActive;

  if (uCursorActive > 0.5) {
    vec2 cursorActivationOffset = aBase - uCursor;
    float cursorActivationDistanceSquared = dot(cursorActivationOffset, cursorActivationOffset);

    if (cursorActivationDistanceSquared <= uCursorActivationRadiusSquared) {
      nextActive = 1.0;
    }
  }

  for (int index = 0; index < MAX_WAVES; index += 1) {
    if (index >= uWaveCount) break;

    vec2 waveActivationOffset = aBase - uWaveCenter[index];
    float waveActivationDistanceSquared = dot(waveActivationOffset, waveActivationOffset);

    if (
      waveActivationDistanceSquared >= uWaveActivationInnerRadiusSquared[index] &&
      waveActivationDistanceSquared <= uWaveActivationOuterRadiusSquared[index]
    ) {
      nextActive = 1.0;
    }
  }

  for (int index = 0; index < MAX_IMPULSES; index += 1) {
    if (index >= uImpulseCount) break;

    vec2 impulseOffset = aBase - uImpulseCenter[index];
    float impulseDistanceSquared = dot(impulseOffset, impulseOffset);

    if (impulseDistanceSquared > uImpulseRadiusSquared[index]) continue;

    float impulseDistance = sqrt(impulseDistanceSquared);
    vec2 impulseDirection = directionFor(impulseOffset, impulseDistance, aVibrance);
    float normalizedDistance = impulseDistance / uImpulseRadius[index];
    float falloff = exp(-(normalizedDistance * normalizedDistance) * 1.85);
    float angularNoise = (aVibrance - 0.5) * uImpulseForce[index] * falloff * 0.32;
    float impulse = uImpulseForce[index] * falloff;

    nextActive = 1.0;
    velocity += vec2(
      impulseDirection.x * impulse - impulseDirection.y * angularNoise,
      impulseDirection.y * impulse + impulseDirection.x * angularNoise
    );
    position += impulseDirection * impulse * 0.34;
    energy += falloff * 0.48;
  }

  if (nextActive < 0.5) {
    vNextPosition = aBase;
    vNextVelocity = vec2(0.0);
    vNextEnergy = 0.0;
    vNextActive = 0.0;
    return;
  }

  vec2 restore = aBase - position;
  vec2 acceleration = restore * uSpring;
  float localEnergy = 0.0;

  if (uCursorActive > 0.5) {
    vec2 cursorOffset = position - uCursor;
    float cursorDistanceSquared = dot(cursorOffset, cursorOffset);

    if (cursorDistanceSquared <= uCursorRadiusSquared) {
      float cursorDistance = sqrt(cursorDistanceSquared);
      vec2 cursorDirection = directionFor(cursorOffset, cursorDistance, aVibrance);
      float normalizedDistance = cursorDistance / uCursorRadius;
      float pressure = exp(-normalizedDistance * normalizedDistance * 1.38) * uCursorStrength;
      float cursorSpeed = length(uCursorVelocity);
      float speedPressure = clamp(cursorSpeed / uCursorRadius, 0.0, 1.45);
      float wake = exp(-normalizedDistance * normalizedDistance * 0.62) * uCursorStrength * speedPressure;
      float swirl = (aVibrance - 0.5) * pressure * uCursorPush * (0.26 + speedPressure * 0.16);

      acceleration += cursorDirection * pressure * uCursorPush * (1.0 + speedPressure * 0.34);
      acceleration += vec2(
        uCursorVelocity.x * wake * uCursorSweep - cursorDirection.y * swirl,
        uCursorVelocity.y * wake * uCursorSweep + cursorDirection.x * swirl
      );
      localEnergy += pressure * (0.18 + speedPressure * 0.14);
    }
  }

  for (int index = 0; index < MAX_WAVES; index += 1) {
    if (index >= uWaveCount) break;

    vec2 waveOffset = position - uWaveCenter[index];
    float waveDistanceSquared = dot(waveOffset, waveOffset);

    if (
      waveDistanceSquared < uWaveInnerRadiusSquared[index] ||
      waveDistanceSquared > uWaveOuterRadiusSquared[index]
    ) {
      continue;
    }

    float waveDistance = sqrt(waveDistanceSquared);
    vec2 waveDirection = directionFor(waveOffset, waveDistance, aVibrance);
    float frontDistance = waveDistance - uWaveFrontRadius[index];
    float band = exp(-pow(frontDistance / uWaveWidth[index], 2.0) * 0.38);
    float pulse = band * uWaveEnvelope[index];
    float aftershock = exp(-pow((frontDistance + uWaveWidth[index] * 2.15) / (uWaveWidth[index] * 2.05), 2.0) * 0.42) * uWaveEnvelope[index];

    acceleration += waveDirection * (pulse * uWaveForce[index] - aftershock * uWaveForce[index] * 0.12);
    localEnergy += pulse * 0.24 + aftershock * 0.08;
  }

  velocity = (velocity + acceleration * uStep) * uDamping;

  float speed = length(velocity);
  position += velocity * uStep;

  vec2 displacementVector = position - aBase;
  float displacement = length(displacementVector);
  float targetEnergy = max(localEnergy + speed * 0.032 + (displacement / uDiagonal) * 2.3, 0.0);
  float energyFollow = 1.0 - pow(targetEnergy > energy ? 0.7 : 0.93, uStep);

  energy = mix(energy, targetEnergy, energyFollow);

  if (speed + displacement * 0.04 + energy > 0.012 || localEnergy > 0.001) {
    vNextPosition = position;
    vNextVelocity = velocity;
    vNextEnergy = energy;
    vNextActive = 1.0;
  } else {
    vNextPosition = aBase;
    vNextVelocity = vec2(0.0);
    vNextEnergy = 0.0;
    vNextActive = 0.0;
  }
}
`;

const passthroughFragmentShaderSource = `#version 300 es
precision highp float;

out vec4 outColor;

void main() {
  outColor = vec4(0.0);
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

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  transformFeedbackVaryings?: string[],
) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);

  if (transformFeedbackVaryings) {
    gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.SEPARATE_ATTRIBS);
  }

  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;

  gl.deleteProgram(program);
  return null;
};

const createGpuBufferSet = (gl: WebGL2RenderingContext): GpuBufferSet | null => {
  const position = gl.createBuffer();
  const velocity = gl.createBuffer();
  const energy = gl.createBuffer();
  const active = gl.createBuffer();

  if (!position || !velocity || !energy || !active) return null;

  return {
    active,
    energy,
    position,
    velocity,
  };
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

    const renderProgram = createProgram(gl, renderVertexShaderSource, fragmentShaderSource);
    const updateProgram = createProgram(
      gl,
      updateVertexShaderSource,
      passthroughFragmentShaderSource,
      ["vNextPosition", "vNextVelocity", "vNextEnergy", "vNextActive"],
    );
    if (!renderProgram || !updateProgram) return;
    const activateProgram = gl.useProgram.bind(gl);

    const getAttribute = (program: WebGLProgram, name: string) => {
      const attribute = gl.getAttribLocation(program, name);
      if (attribute < 0) throw new Error(`Missing WebGL attribute: ${name}`);

      return attribute;
    };
    const getUniform = (program: WebGLProgram, name: string) => {
      const uniform = gl.getUniformLocation(program, name);
      if (!uniform) throw new Error(`Missing WebGL uniform: ${name}`);

      return uniform;
    };

    const renderAttributes = {
      energy: getAttribute(renderProgram, "aEnergy"),
      opacity: getAttribute(renderProgram, "aOpacity"),
      position: getAttribute(renderProgram, "aPosition"),
      radius: getAttribute(renderProgram, "aRadius"),
      vibrance: getAttribute(renderProgram, "aVibrance"),
    };
    const updateAttributes = {
      active: getAttribute(updateProgram, "aActive"),
      base: getAttribute(updateProgram, "aBase"),
      energy: getAttribute(updateProgram, "aEnergy"),
      position: getAttribute(updateProgram, "aPosition"),
      velocity: getAttribute(updateProgram, "aVelocity"),
      vibrance: getAttribute(updateProgram, "aVibrance"),
    };
    const renderUniforms = {
      color: getUniform(renderProgram, "uColor"),
      resolution: getUniform(renderProgram, "uResolution"),
      time: getUniform(renderProgram, "uTime"),
    };
    const updateUniforms = {
      cursor: getUniform(updateProgram, "uCursor"),
      cursorActivationRadiusSquared: getUniform(updateProgram, "uCursorActivationRadiusSquared"),
      cursorActive: getUniform(updateProgram, "uCursorActive"),
      cursorPush: getUniform(updateProgram, "uCursorPush"),
      cursorRadius: getUniform(updateProgram, "uCursorRadius"),
      cursorRadiusSquared: getUniform(updateProgram, "uCursorRadiusSquared"),
      cursorStrength: getUniform(updateProgram, "uCursorStrength"),
      cursorSweep: getUniform(updateProgram, "uCursorSweep"),
      cursorVelocity: getUniform(updateProgram, "uCursorVelocity"),
      damping: getUniform(updateProgram, "uDamping"),
      diagonal: getUniform(updateProgram, "uDiagonal"),
      impulseCenter: getUniform(updateProgram, "uImpulseCenter[0]"),
      impulseCount: getUniform(updateProgram, "uImpulseCount"),
      impulseForce: getUniform(updateProgram, "uImpulseForce[0]"),
      impulseRadius: getUniform(updateProgram, "uImpulseRadius[0]"),
      impulseRadiusSquared: getUniform(updateProgram, "uImpulseRadiusSquared[0]"),
      spring: getUniform(updateProgram, "uSpring"),
      step: getUniform(updateProgram, "uStep"),
      waveActivationInnerRadiusSquared: getUniform(
        updateProgram,
        "uWaveActivationInnerRadiusSquared[0]",
      ),
      waveActivationOuterRadiusSquared: getUniform(
        updateProgram,
        "uWaveActivationOuterRadiusSquared[0]",
      ),
      waveCenter: getUniform(updateProgram, "uWaveCenter[0]"),
      waveCount: getUniform(updateProgram, "uWaveCount"),
      waveEnvelope: getUniform(updateProgram, "uWaveEnvelope[0]"),
      waveForce: getUniform(updateProgram, "uWaveForce[0]"),
      waveFrontRadius: getUniform(updateProgram, "uWaveFrontRadius[0]"),
      waveInnerRadiusSquared: getUniform(updateProgram, "uWaveInnerRadiusSquared[0]"),
      waveOuterRadiusSquared: getUniform(updateProgram, "uWaveOuterRadiusSquared[0]"),
      waveWidth: getUniform(updateProgram, "uWaveWidth[0]"),
    };

    const staticBuffer = gl.createBuffer();
    const firstStateBuffers = createGpuBufferSet(gl);
    const secondStateBuffers = createGpuBufferSet(gl);
    const transformFeedback = gl.createTransformFeedback();
    const firstRenderVertexArray = gl.createVertexArray();
    const secondRenderVertexArray = gl.createVertexArray();
    const firstUpdateVertexArray = gl.createVertexArray();
    const secondUpdateVertexArray = gl.createVertexArray();

    if (
      !staticBuffer ||
      !firstStateBuffers ||
      !secondStateBuffers ||
      !transformFeedback ||
      !firstRenderVertexArray ||
      !secondRenderVertexArray ||
      !firstUpdateVertexArray ||
      !secondUpdateVertexArray
    )
      return;

    const stateBuffers = [firstStateBuffers, secondStateBuffers] as const;
    const renderVertexArrays = [firstRenderVertexArray, secondRenderVertexArray] as const;
    const updateVertexArrays = [firstUpdateVertexArray, secondUpdateVertexArray] as const;
    let readBufferIndex: 0 | 1 = 0;

    const bindFloatAttribute = (
      attribute: number,
      buffer: WebGLBuffer,
      size: number,
      stride: number,
      offset: number,
      divisor: number,
    ) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(attribute, divisor);
    };

    const configureVertexArrays = (index: 0 | 1) => {
      gl.bindVertexArray(renderVertexArrays[index]);
      bindFloatAttribute(renderAttributes.position, stateBuffers[index].position, 2, 0, 0, 1);
      bindFloatAttribute(renderAttributes.energy, stateBuffers[index].energy, 1, 0, 0, 1);
      bindFloatAttribute(
        renderAttributes.radius,
        staticBuffer,
        1,
        particleStaticStrideBytes,
        2 * Float32Array.BYTES_PER_ELEMENT,
        1,
      );
      bindFloatAttribute(
        renderAttributes.opacity,
        staticBuffer,
        1,
        particleStaticStrideBytes,
        3 * Float32Array.BYTES_PER_ELEMENT,
        1,
      );
      bindFloatAttribute(
        renderAttributes.vibrance,
        staticBuffer,
        1,
        particleStaticStrideBytes,
        4 * Float32Array.BYTES_PER_ELEMENT,
        1,
      );

      gl.bindVertexArray(updateVertexArrays[index]);
      bindFloatAttribute(updateAttributes.base, staticBuffer, 2, particleStaticStrideBytes, 0, 0);
      bindFloatAttribute(
        updateAttributes.vibrance,
        staticBuffer,
        1,
        particleStaticStrideBytes,
        4 * Float32Array.BYTES_PER_ELEMENT,
        0,
      );
      bindFloatAttribute(updateAttributes.position, stateBuffers[index].position, 2, 0, 0, 0);
      bindFloatAttribute(updateAttributes.velocity, stateBuffers[index].velocity, 2, 0, 0, 0);
      bindFloatAttribute(updateAttributes.energy, stateBuffers[index].energy, 1, 0, 0, 0);
      bindFloatAttribute(updateAttributes.active, stateBuffers[index].active, 1, 0, 0, 0);
    };

    configureVertexArrays(0);
    configureVertexArrays(1);

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let animationFrame = 0;
    let bufferWidth = 0;
    let bufferHeight = 0;
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
    const waveCenters = new Float32Array(maxWaveCount * 2);
    const waveForces = new Float32Array(maxWaveCount);
    const waveEnvelopes = new Float32Array(maxWaveCount);
    const waveFrontRadii = new Float32Array(maxWaveCount);
    const waveWidths = new Float32Array(maxWaveCount);
    const waveInnerRadiiSquared = new Float32Array(maxWaveCount);
    const waveOuterRadiiSquared = new Float32Array(maxWaveCount);
    const waveActivationInnerRadiiSquared = new Float32Array(maxWaveCount);
    const waveActivationOuterRadiiSquared = new Float32Array(maxWaveCount);
    const impulseCenters = new Float32Array(maxImpulseCount * 2);
    const impulseRadii = new Float32Array(maxImpulseCount);
    const impulseRadiiSquared = new Float32Array(maxImpulseCount);
    const impulseForces = new Float32Array(maxImpulseCount);
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

    const uploadStateData = (
      positions: Float32Array,
      velocities: Float32Array,
      energies: Float32Array,
      activeFlags: Float32Array,
    ) => {
      for (const bufferSet of stateBuffers) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferSet.position);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_COPY);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferSet.velocity);
        gl.bufferData(gl.ARRAY_BUFFER, velocities, gl.DYNAMIC_COPY);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferSet.energy);
        gl.bufferData(gl.ARRAY_BUFFER, energies, gl.DYNAMIC_COPY);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferSet.active);
        gl.bufferData(gl.ARRAY_BUFFER, activeFlags, gl.DYNAMIC_COPY);
      }
    };

    const syncDots = () => {
      const dots = buildDots(bufferWidth, bufferHeight, particleGap);
      const staticData = new Float32Array(dots.length * particleStaticStride);
      const positions = new Float32Array(dots.length * 2);
      const velocities = new Float32Array(dots.length * 2);
      const energies = new Float32Array(dots.length);
      const activeFlags = new Float32Array(dots.length);

      particleCount = dots.length;
      readBufferIndex = 0;

      for (const [index, dot] of dots.entries()) {
        const staticOffset = index * particleStaticStride;
        const positionOffset = index * 2;

        staticData[staticOffset] = dot.x;
        staticData[staticOffset + 1] = dot.y;
        staticData[staticOffset + 2] = dot.radius;
        staticData[staticOffset + 3] = dot.opacity;
        staticData[staticOffset + 4] = dot.vibrance;
        positions[positionOffset] = dot.x;
        positions[positionOffset + 1] = dot.y;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, staticData, gl.STATIC_DRAW);
      uploadStateData(positions, velocities, energies, activeFlags);
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
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      syncDots();
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

    const syncWaveUniformData = (activeWaves: WaveFrame[]) => {
      for (const [index, wave] of activeWaves.entries()) {
        const centerOffset = index * 2;

        waveCenters[centerOffset] = wave.x;
        waveCenters[centerOffset + 1] = wave.y;
        waveForces[index] = wave.force;
        waveEnvelopes[index] = wave.envelope;
        waveFrontRadii[index] = wave.frontRadius;
        waveWidths[index] = wave.width;
        waveInnerRadiiSquared[index] = wave.innerRadiusSquared;
        waveOuterRadiiSquared[index] = wave.outerRadiusSquared;
        waveActivationInnerRadiiSquared[index] = wave.activationInnerRadiusSquared;
        waveActivationOuterRadiiSquared[index] = wave.activationOuterRadiusSquared;
      }
    };

    const syncImpulseUniformData = (impulses: Impulse[]) => {
      for (const [index, impulse] of impulses.entries()) {
        const centerOffset = index * 2;

        impulseCenters[centerOffset] = impulse.x;
        impulseCenters[centerOffset + 1] = impulse.y;
        impulseRadii[index] = impulse.radius;
        impulseRadiiSquared[index] = impulse.radius * impulse.radius;
        impulseForces[index] = impulse.force;
      }
    };

    const runGpuSimulation = (
      elapsedMs: number,
      activeWaves: WaveFrame[],
      impulses: Impulse[],
      cursorActive: boolean,
    ) => {
      const step = elapsedMs / 16.667;
      const minSide = Math.min(bufferWidth, bufferHeight);
      const diagonal = Math.hypot(bufferWidth, bufferHeight);
      const cursorRadius = clamp(minSide * 0.066, 42, 96);
      const cursorActivationRadius = cursorRadius * 2.35;
      const cursorPush = clamp(minSide * 0.00125, 0.72, 1.9);
      const cursorSweep = clamp(minSide * 0.00014, 0.07, 0.24);
      const spring = 0.032;
      const damping = 0.87 ** step;
      const writeBufferIndex: 0 | 1 = readBufferIndex === 0 ? 1 : 0;

      syncWaveUniformData(activeWaves);
      syncImpulseUniformData(impulses);
      activateProgram(updateProgram);
      gl.bindVertexArray(updateVertexArrays[readBufferIndex]);
      gl.uniform1f(updateUniforms.step, step);
      gl.uniform1f(updateUniforms.spring, spring);
      gl.uniform1f(updateUniforms.damping, damping);
      gl.uniform1f(updateUniforms.diagonal, diagonal);
      gl.uniform1f(updateUniforms.cursorActive, cursorActive ? 1 : 0);
      gl.uniform2f(updateUniforms.cursor, cursorPosition?.x ?? 0, cursorPosition?.y ?? 0);
      gl.uniform2f(
        updateUniforms.cursorVelocity,
        cursorVelocityX * 16.667,
        cursorVelocityY * 16.667,
      );
      gl.uniform1f(updateUniforms.cursorRadius, cursorRadius);
      gl.uniform1f(
        updateUniforms.cursorRadiusSquared,
        cursorActivationRadius * cursorActivationRadius,
      );
      gl.uniform1f(
        updateUniforms.cursorActivationRadiusSquared,
        cursorActivationRadius * cursorActivationRadius,
      );
      gl.uniform1f(updateUniforms.cursorPush, cursorPush);
      gl.uniform1f(updateUniforms.cursorSweep, cursorSweep);
      gl.uniform1f(updateUniforms.cursorStrength, cursorStrength);
      gl.uniform1i(updateUniforms.waveCount, activeWaves.length);
      gl.uniform2fv(updateUniforms.waveCenter, waveCenters);
      gl.uniform1fv(updateUniforms.waveForce, waveForces);
      gl.uniform1fv(updateUniforms.waveEnvelope, waveEnvelopes);
      gl.uniform1fv(updateUniforms.waveFrontRadius, waveFrontRadii);
      gl.uniform1fv(updateUniforms.waveWidth, waveWidths);
      gl.uniform1fv(updateUniforms.waveInnerRadiusSquared, waveInnerRadiiSquared);
      gl.uniform1fv(updateUniforms.waveOuterRadiusSquared, waveOuterRadiiSquared);
      gl.uniform1fv(
        updateUniforms.waveActivationInnerRadiusSquared,
        waveActivationInnerRadiiSquared,
      );
      gl.uniform1fv(
        updateUniforms.waveActivationOuterRadiusSquared,
        waveActivationOuterRadiiSquared,
      );
      gl.uniform1i(updateUniforms.impulseCount, impulses.length);
      gl.uniform2fv(updateUniforms.impulseCenter, impulseCenters);
      gl.uniform1fv(updateUniforms.impulseRadius, impulseRadii);
      gl.uniform1fv(updateUniforms.impulseRadiusSquared, impulseRadiiSquared);
      gl.uniform1fv(updateUniforms.impulseForce, impulseForces);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, stateBuffers[writeBufferIndex].position);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, stateBuffers[writeBufferIndex].velocity);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, stateBuffers[writeBufferIndex].energy);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 3, stateBuffers[writeBufferIndex].active);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, particleCount);
      gl.endTransformFeedback();
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, null);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 3, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindVertexArray(null);
      readBufferIndex = writeBufferIndex;
    };

    const simulateParticles = (now: number) => {
      if (!canAnimateParticles) return false;

      const elapsedMs = lastRenderTime ? clamp(now - lastRenderTime, 8, 34) : 16.667;
      const cursorMoving = syncCursor(elapsedMs);
      const cursorActive = !!cursorPosition && cursorStrength > 0.002;
      const settlingDuration = 2200;
      const impulses = pendingImpulses.slice(-maxImpulseCount);
      const activeWaves: WaveFrame[] = [];

      waves = waves.filter((wave) => now - wave.startedAt <= wave.life);

      for (const wave of waves) {
        const age = now - wave.startedAt;
        const frontRadius = age * wave.speed;
        const outerRadius = frontRadius + wave.width * 3.8;
        const innerRadius = Math.max(0, frontRadius - wave.width * 6.6);
        const activationOuterRadius = frontRadius + wave.width * 2.7;
        const activationInnerRadius = Math.max(0, wave.activatedRadius - wave.width * 5.6);

        if (activationOuterRadius > wave.activatedRadius) {
          wave.activatedRadius = activationOuterRadius;
        }

        activeWaves.push({
          ...wave,
          activationInnerRadiusSquared: activationInnerRadius * activationInnerRadius,
          activationOuterRadiusSquared: activationOuterRadius * activationOuterRadius,
          envelope: (1 - age / wave.life) ** 1.12,
          frontRadius,
          innerRadiusSquared: innerRadius * innerRadius,
          outerRadiusSquared: outerRadius * outerRadius,
        });
      }

      if (cursorActive || activeWaves.length > 0 || impulses.length > 0) {
        settleUntil = Math.max(settleUntil, now + settlingDuration);
      }

      if (particlesSettled && !cursorActive && activeWaves.length === 0 && impulses.length === 0) {
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

      runGpuSimulation(elapsedMs, activeWaves, impulses, cursorActive);
      pendingImpulses = [];

      const shouldContinue = cursorMoving || waves.length > 0 || now < settleUntil;

      particlesSettled = !shouldContinue;
      return shouldContinue;
    };

    const render = () => {
      const now = globalThis.performance.now();
      const isActive = simulateParticles(now);
      const color = colors.primary;
      const background = colors.background;

      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      activateProgram(renderProgram);
      gl.bindVertexArray(renderVertexArrays[readBufferIndex]);
      gl.uniform2f(renderUniforms.resolution, bufferWidth, bufferHeight);
      gl.uniform3f(renderUniforms.color, color[0], color[1], color[2]);
      gl.uniform1f(renderUniforms.time, now / 1000);
      gl.drawArraysInstanced(gl.POINTS, 0, 1, particleCount);
      gl.bindVertexArray(null);
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
      const force = clamp(unit * 0.044, 3.1, 8.2);
      const waveForce = clamp(unit * 0.037, 2.6, 7);
      const impulseRadius = clamp(width * 1.28, 62, 190);
      const impulseForce = clamp(force * 1.24, 4.4, 13.5);
      const previousWaves = waves.filter((wave) => now - wave.startedAt <= wave.life);

      if (canTrackCursor && (event.pointerType === "mouse" || event.pointerType === "pen")) {
        cursorTarget = canvasPoint;
        isPointerInside = true;
      }

      particlesSettled = false;
      pendingImpulses = [
        ...pendingImpulses,
        {
          ...canvasPoint,
          force: impulseForce,
          radius: impulseRadius,
        },
      ].slice(-maxImpulseCount);
      waves = [
        ...previousWaves,
        {
          ...canvasPoint,
          activatedRadius: 0,
          force: waveForce,
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

      gl.deleteBuffer(staticBuffer);

      for (const bufferSet of stateBuffers) {
        gl.deleteBuffer(bufferSet.position);
        gl.deleteBuffer(bufferSet.velocity);
        gl.deleteBuffer(bufferSet.energy);
        gl.deleteBuffer(bufferSet.active);
      }

      for (const vertexArray of renderVertexArrays) {
        gl.deleteVertexArray(vertexArray);
      }

      for (const vertexArray of updateVertexArrays) {
        gl.deleteVertexArray(vertexArray);
      }

      gl.deleteTransformFeedback(transformFeedback);
      gl.deleteProgram(renderProgram);
      gl.deleteProgram(updateProgram);
    };
  }, []);

  return (
    <canvas
      aria-hidden="true"
      className="block size-full bg-background"
      ref={canvasRef}
      role="presentation"
      tabIndex={-1}
    />
  );
};
