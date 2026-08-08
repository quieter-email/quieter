"use client";

import { cn } from "@quieter/ui/cn";
import { useEffect, useRef, useState } from "react";

/**
 * Atmospheric background — soft light fields + curved highlight ridges with
 * noise-driven mood. Charcoal / navy / off-white, quiet grain (no flickering
 * vignette). QUIETER-176. Opt in on branded surfaces; `fadeTop` / `fadeBottom`
 * settle into black or elevated at hard section cuts.
 *
 * Perf: full visual fidelity (DPR ≤ 2). Per-frame globals run once on the CPU;
 * WebGL init + RAF only while near the viewport.
 */

const MAX_PIXEL_RATIO = 2;
const REVEAL_MS = 3000;
/** Start compiling slightly before scroll-in so below-fold sections are ready. */
const VISIBLE_ROOT_MARGIN = "120px 0px";

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Spatial field only — mood/drift/phases/angles arrive as uniforms so every
 * pixel does not recompute the same global noise and ridge rotations.
 */
const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;
uniform float uGrain;
uniform float uAnimate;
uniform vec3 uSeed;
uniform float uFadeTop;
uniform float uFadeBottom;
uniform vec3 uFadeColorTop;
uniform vec3 uFadeColorBottom;

// Per-frame globals (same for every pixel)
uniform float uMood;
uniform float uHardness;
uniform float uThick;
uniform vec2 uDrift;
uniform vec3 uPhase;
uniform vec2 uLayout;
uniform vec2 uRidgeAmp;
uniform vec2 uCosA;
uniform vec2 uCosB;
uniform vec2 uCosC;
uniform float uGrainTick;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float softGlow(vec2 p, vec2 center, vec2 radius) {
  vec2 d = (p - center) / radius;
  return exp(-dot(d, d));
}

float ridge(vec2 p, float phase, float thickness, float hard, vec2 cs, float freq) {
  float ca = cs.x;
  float sa = cs.y;
  vec2 r = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  float fold =
    r.y
    - (
      -0.1
      + 0.3 * sin(r.x * (1.15 * freq) + phase)
      + 0.12 * sin(r.x * (2.35 * freq) + phase * 1.7)
      + 0.05 * sin(r.x * (4.2 * freq) - phase * 0.65)
    );
  float soft = exp(-(fold * fold) / max(thickness * thickness, 0.0001));
  float sharp = mix(0.55, 16.0, clamp(hard, 0.0, 1.0));
  return pow(soft, sharp);
}

float layerLight(float a, float b) {
  return a + b * (1.0 - a);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * uAnimate * 0.095 + uSeed.x * 40.0;

  float mood = uMood;
  float hardness = uHardness;
  float drift = uDrift.x;
  float drift2 = uDrift.y;
  vec2 q = p - uLayout;

  float ambient =
    softGlow(q, vec2(-0.25 + drift, -0.06 + drift2), vec2(1.2, 0.8)) * 0.4 +
    softGlow(q, vec2(0.3 - drift2, 0.08 + drift), vec2(0.95, 0.65)) * 0.28;

  float blueField =
    softGlow(q, vec2(0.5 + drift2, 0.0 - drift), vec2(0.55, 0.4)) * 0.75 +
    softGlow(q, vec2(0.18 - drift, -0.28), vec2(0.36, 0.28)) * 0.45 +
    softGlow(q, vec2(-0.55 + drift, 0.22), vec2(0.34, 0.26)) * mix(0.2, 0.55, mood) +
    softGlow(q, vec2(0.72 + drift * 0.4, 0.32), vec2(0.28, 0.22)) * 0.35 +
    softGlow(q, vec2(-0.2 - drift2, -0.4), vec2(0.4, 0.2)) * 0.3;
  float blueBreak =
    valueNoise3(vec3(q * 2.4 + drift, t * 0.14 + uSeed.y)) * 0.55
    + valueNoise3(vec3(q * 5.2 - drift2, t * 0.1 + uSeed.z + 2.0)) * 0.35;
  float blueHole = softGlow(q, vec2(-0.05 + drift2, 0.08), vec2(0.55, 0.35)) * 0.4;
  blueField *= mix(0.35, 1.15, blueBreak);
  blueField *= 1.0 - blueHole * mix(0.25, 0.55, 1.0 - mood);
  blueField = clamp(blueField, 0.0, 1.0);

  float thick = uThick;
  float ridgeMain = ridge(
    q + vec2(drift * 0.5, drift2),
    uPhase.x,
    thick,
    hardness,
    uCosA,
    0.95
  );
  float ridgeB = ridge(
    q * vec2(1.08, 0.94) + vec2(0.32, -0.2),
    uPhase.y,
    thick * 1.12,
    hardness,
    uCosB,
    0.68
  );
  float ridgeC = ridge(
    q * vec2(0.9, 1.14) + vec2(-0.36, 0.22),
    uPhase.z,
    thick * 0.88,
    hardness,
    uCosC,
    1.4
  );

  float bloom =
    softGlow(q, vec2(-0.34 + drift, -0.1 + drift2), vec2(0.58, 0.24)) * 0.6 +
    softGlow(q, vec2(-0.02 + drift2, 0.1), vec2(0.36, 0.17)) * 0.4;

  float ridgeLayer = layerLight(
    ridgeMain * 1.2,
    layerLight(ridgeB * uRidgeAmp.x, ridgeC * uRidgeAmp.y)
  );
  float highlight = layerLight(ridgeLayer, bloom * 0.55);
  highlight = clamp(highlight * uIntensity, 0.0, 1.0);

  float valley =
    softGlow(q, vec2(0.1 + drift, -0.02), vec2(0.4, 0.16)) * 0.65 +
    softGlow(q, vec2(-0.42, 0.2), vec2(0.28, 0.12)) * 0.4;
  highlight *= 1.0 - valley * mix(0.35, 0.55, mood);

  float textSafe = softGlow(p, vec2(0.0, 0.02), vec2(0.7, 0.36));
  highlight *= mix(1.0, 0.3, textSafe * 0.9);
  ambient *= mix(1.0, 0.6, textSafe * 0.65);

  vec3 black = vec3(0.0);
  vec3 charcoal = vec3(0.045, 0.05, 0.06);
  vec3 navy = vec3(0.07, 0.09, 0.13);
  vec3 dustyBlue = vec3(0.15, 0.19, 0.27);
  vec3 steel = vec3(0.32, 0.36, 0.42);
  vec3 offWhite = vec3(0.8, 0.82, 0.86);

  float blueAmt = mix(0.4, 0.85, mood);
  float blueTone = valueNoise3(vec3(q * 1.6 + uSeed.xy, t * 0.12));
  vec3 color = mix(black, charcoal, clamp(ambient + 0.3, 0.0, 1.0));
  color = mix(color, navy, clamp(blueField * 0.65 * blueAmt * mix(0.7, 1.15, blueTone), 0.0, 1.0));
  color = mix(
    color,
    dustyBlue,
    clamp(blueField * 0.28 * blueAmt * mix(0.5, 1.2, 1.0 - blueTone), 0.0, 1.0)
  );
  color = mix(color, steel, smoothstep(0.12, 0.5, highlight) * 0.55);
  color = mix(color, offWhite, pow(smoothstep(0.32, 0.92, highlight), mix(1.5, 2.3, hardness)));

  float side = min(uv.x, 1.0 - uv.x);
  float fromTop = 1.0 - uv.y;
  float edgeMask = smoothstep(0.0, 0.1, side) * smoothstep(0.0, 0.14, fromTop);
  color *= mix(0.88, 1.0, edgeMask);

  if (uFadeBottom > 0.5) {
    color = mix(uFadeColorBottom, color, smoothstep(0.0, 0.16, uv.y));
  }
  if (uFadeTop > 0.5) {
    color = mix(uFadeColorTop, color, smoothstep(0.0, 0.16, 1.0 - uv.y));
  }

  float gn = hash12(gl_FragCoord.xy + uGrainTick * 17.0);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color += (gn - 0.5) * mix(0.02, 0.045, smoothstep(0.02, 0.3, luma)) * uGrain;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/** Matches dark `--bg-elevated` (oklch 0.145). */
const ELEVATED_RGB = [0.145, 0.145, 0.145] as const;
const BLACK_RGB = [0, 0, 0] as const;

type FadeTarget = "black" | "elevated";

type AtmosphericBackgroundProps = {
  className?: string;
  /** Film grain strength. Default 1. */
  grain?: number;
  /** Light-field strength. Default 1. */
  intensity?: number;
  /** When false, freezes motion (also auto for prefers-reduced-motion). Default true. */
  animate?: boolean;
  /** Fade the top edge into this band color (hard cut to the section above). */
  fadeTop?: FadeTarget;
  /** Fade the bottom edge into this band color (hard cut to the section below). */
  fadeBottom?: FadeTarget;
};

const fadeTargetRgb = (target: FadeTarget | undefined) =>
  target === "elevated" ? ELEVATED_RGB : BLACK_RGB;

const f32 = Math.fround;

const fract = (value: number) => f32(value - Math.floor(value));

const hash13 = (x: number, y: number, z: number) => {
  let px = fract(f32(x * 0.1031));
  let py = fract(f32(y * 0.1031));
  let pz = fract(f32(z * 0.1031));
  const dot = f32(px * f32(pz + 31.32) + py * f32(py + 31.32) + pz * f32(px + 31.32));
  // GLSL: p += dot(p, p.zyx + 31.32) → each component += same scalar dot
  px = f32(px + dot);
  py = f32(py + dot);
  pz = f32(pz + dot);
  return fract(f32(f32(px + py) * pz));
};

const valueNoise3 = (x: number, y: number, z: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = fract(x);
  let fy = fract(y);
  let fz = fract(z);
  fx = f32(fx * fx * f32(3 - 2 * fx));
  fy = f32(fy * fy * f32(3 - 2 * fy));
  fz = f32(fz * fz * f32(3 - 2 * fz));

  const n000 = hash13(ix, iy, iz);
  const n100 = hash13(ix + 1, iy, iz);
  const n010 = hash13(ix, iy + 1, iz);
  const n110 = hash13(ix + 1, iy + 1, iz);
  const n001 = hash13(ix, iy, iz + 1);
  const n101 = hash13(ix + 1, iy, iz + 1);
  const n011 = hash13(ix, iy + 1, iz + 1);
  const n111 = hash13(ix + 1, iy + 1, iz + 1);

  const nx00 = f32(n000 + f32(n100 - n000) * fx);
  const nx10 = f32(n010 + f32(n110 - n010) * fx);
  const nx01 = f32(n001 + f32(n101 - n001) * fx);
  const nx11 = f32(n011 + f32(n111 - n011) * fx);
  const nxy0 = f32(nx00 + f32(nx10 - nx00) * fy);
  const nxy1 = f32(nx01 + f32(nx11 - nx01) * fy);
  return f32(nxy0 + f32(nxy1 - nxy0) * fz);
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, f32(f32(x - edge0) / f32(edge1 - edge0))));
  return f32(t * t * f32(3 - 2 * t));
};

const mix = (a: number, b: number, t: number) => f32(a + f32(b - a) * t);

type FrameGlobals = {
  mood: number;
  detail: number;
  hardness: number;
  thick: number;
  drift: number;
  drift2: number;
  phaseA: number;
  phaseB: number;
  phaseC: number;
  ridgeAmpB: number;
  ridgeAmpC: number;
  grainTick: number;
};

const computeFrameGlobals = (
  timeSeconds: number,
  animate: boolean,
  seed: readonly [number, number, number],
): FrameGlobals => {
  const sx = seed[0];
  const sy = seed[1];
  const sz = seed[2];
  const t = f32(f32(timeSeconds * (animate ? 1 : 0) * 0.095) + f32(sx * 40));

  const mood = valueNoise3(f32(t * 0.22), sy, f32(t * 0.16));
  const detail = valueNoise3(f32(sz + 1.2), f32(t * 0.2), f32(t * 0.18));
  const hardnessNoise = valueNoise3(f32(t * 0.07 + sx), 2.1, sy);
  const hardness = mix(0.06, 0.98, smoothstep(0.42, 0.58, hardnessNoise));
  const drift = f32(f32(valueNoise3(f32(t * 0.4), sy, 1) - 0.5) * 0.18);
  const drift2 = f32(f32(valueNoise3(sz, f32(t * 0.38), 2) - 0.5) * 0.15);
  const thickNoise = valueNoise3(f32(t * 0.08 + sz), 3.7, sy);
  const thick = f32(mix(0.16, 0.26, thickNoise) * mix(1, 0.9, hardness));

  return {
    mood,
    detail,
    hardness,
    thick,
    drift,
    drift2,
    phaseA: f32(f32(sx * 6.28318) + f32(t * 1.42)),
    phaseB: f32(f32(sy * 6.28318) + f32(t * 0.58) + 2.4),
    phaseC: f32(f32(sz * 6.28318) - f32(t * 1.95) - 1.1),
    ridgeAmpB: mix(0.2, 0.7, detail),
    ridgeAmpC: mix(0.05, 0.55, detail),
    grainTick: animate ? Math.floor(f32(timeSeconds * 3 + sx * 100)) : f32(sx * 100),
  };
};

const compileShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }

  return shader;
};

type UniformSet = {
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
  mood: WebGLUniformLocation;
  hardness: WebGLUniformLocation;
  thick: WebGLUniformLocation;
  drift: WebGLUniformLocation;
  phase: WebGLUniformLocation;
  ridgeAmp: WebGLUniformLocation;
  grainTick: WebGLUniformLocation;
};

export const AtmosphericBackground = ({
  animate = true,
  className,
  fadeBottom,
  fadeTop,
  grain = 1,
  intensity = 1,
}: AtmosphericBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const underlay = fadeBottom === "elevated" ? "bg-bg-elevated" : "bg-black";
  const sessionRef = useRef({
    seed: [Math.random(), Math.random(), Math.random()] as [number, number, number],
    startedAt: performance.now(),
    timeOffset: Math.random() * 120,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let revealed = false;
    let visible = false;
    let raf = 0;
    let resizeObserver: ResizeObserver | null = null;
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let positionBuffer: WebGLBuffer | null = null;
    let width = 0;
    let height = 0;
    let uniforms: UniformSet | null = null;
    let shouldAnimate = false;
    const session = sessionRef.current;
    const [sx, sy, sz] = session.seed;

    const layoutX = f32(f32(sx - 0.5) * 0.55);
    const layoutY = f32(f32(sy - 0.5) * 0.55);
    const angA = f32(-0.22 + f32(sx - 0.5) * 0.55);
    const angB = f32(0.48 + f32(sy - 0.5) * 0.7);
    const angC = f32(-0.61 + f32(sz - 0.5) * 0.65);
    const cosA: [number, number] = [f32(Math.cos(angA)), f32(Math.sin(angA))];
    const cosB: [number, number] = [f32(Math.cos(angB)), f32(Math.sin(angB))];
    const cosC: [number, number] = [f32(Math.cos(angC)), f32(Math.sin(angC))];

    const reveal = () => {
      if (cancelled || revealed) return;
      revealed = true;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setReady(true);
        return;
      }
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true);
      });
    };

    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const draw = (timeSeconds: number) => {
      if (!gl || !uniforms) return;
      const g = computeFrameGlobals(timeSeconds, shouldAnimate, session.seed);
      gl.uniform1f(uniforms.time, timeSeconds);
      gl.uniform1f(uniforms.mood, g.mood);
      gl.uniform1f(uniforms.hardness, g.hardness);
      gl.uniform1f(uniforms.thick, g.thick);
      gl.uniform2f(uniforms.drift, g.drift, g.drift2);
      gl.uniform3f(uniforms.phase, g.phaseA, g.phaseB, g.phaseC);
      gl.uniform2f(uniforms.ridgeAmp, g.ridgeAmpB, g.ridgeAmpC);
      gl.uniform1f(uniforms.grainTick, g.grainTick);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const resize = () => {
      if (!gl || !uniforms || cancelled) return;
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const nextWidth = Math.max(1, Math.ceil(rect.width * pixelRatio));
      const nextHeight = Math.max(1, Math.ceil(rect.height * pixelRatio));

      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth;
        height = nextHeight;
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.uniform2f(uniforms.resolution, width, height);
      }

      draw(
        shouldAnimate
          ? (performance.now() - session.startedAt) * 0.001 + session.timeOffset
          : session.timeOffset,
      );
      reveal();
    };

    const render = (now: number) => {
      draw((now - session.startedAt) * 0.001 + session.timeOffset);
      if (!revealed) reveal();
      raf = requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (!shouldAnimate || raf !== 0 || !visible || cancelled) return;
      raf = requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      if (document.hidden || !visible) {
        stopLoop();
        return;
      }
      startLoop();
    };

    const teardownGl = () => {
      stopLoop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (gl && positionBuffer) gl.deleteBuffer(positionBuffer);
      if (gl && program) gl.deleteProgram(program);
      positionBuffer = null;
      program = null;
      uniforms = null;
      gl = null;
      width = 0;
      height = 0;
    };

    const initGl = () => {
      if (cancelled || gl) return;

      const context = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        desynchronized: true,
        powerPreference: "high-performance",
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        stencil: false,
      });
      if (!context) return;
      gl = context;

      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
      if (!vertexShader || !fragmentShader) {
        gl = null;
        return;
      }

      const nextProgram = gl.createProgram();
      if (!nextProgram) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl = null;
        return;
      }

      gl.attachShader(nextProgram, vertexShader);
      gl.attachShader(nextProgram, fragmentShader);
      gl.linkProgram(nextProgram);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
        gl.deleteProgram(nextProgram);
        gl = null;
        return;
      }

      const nextBuffer = gl.createBuffer();
      if (!nextBuffer) {
        gl.deleteProgram(nextProgram);
        gl = null;
        return;
      }

      program = nextProgram;
      positionBuffer = nextBuffer;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      const positionLocation = gl.getAttribLocation(program, "aPosition");
      const resolutionLocation = gl.getUniformLocation(program, "uResolution");
      const timeLocation = gl.getUniformLocation(program, "uTime");
      const intensityLocation = gl.getUniformLocation(program, "uIntensity");
      const grainLocation = gl.getUniformLocation(program, "uGrain");
      const animateLocation = gl.getUniformLocation(program, "uAnimate");
      const seedLocation = gl.getUniformLocation(program, "uSeed");
      const fadeTopLocation = gl.getUniformLocation(program, "uFadeTop");
      const fadeBottomLocation = gl.getUniformLocation(program, "uFadeBottom");
      const fadeColorTopLocation = gl.getUniformLocation(program, "uFadeColorTop");
      const fadeColorBottomLocation = gl.getUniformLocation(program, "uFadeColorBottom");
      const moodLocation = gl.getUniformLocation(program, "uMood");
      const hardnessLocation = gl.getUniformLocation(program, "uHardness");
      const thickLocation = gl.getUniformLocation(program, "uThick");
      const driftLocation = gl.getUniformLocation(program, "uDrift");
      const phaseLocation = gl.getUniformLocation(program, "uPhase");
      const layoutLocation = gl.getUniformLocation(program, "uLayout");
      const ridgeAmpLocation = gl.getUniformLocation(program, "uRidgeAmp");
      const cosALocation = gl.getUniformLocation(program, "uCosA");
      const cosBLocation = gl.getUniformLocation(program, "uCosB");
      const cosCLocation = gl.getUniformLocation(program, "uCosC");
      const grainTickLocation = gl.getUniformLocation(program, "uGrainTick");

      if (
        positionLocation === -1 ||
        !resolutionLocation ||
        !timeLocation ||
        !intensityLocation ||
        !grainLocation ||
        !animateLocation ||
        !seedLocation ||
        !fadeTopLocation ||
        !fadeBottomLocation ||
        !fadeColorTopLocation ||
        !fadeColorBottomLocation ||
        !moodLocation ||
        !hardnessLocation ||
        !thickLocation ||
        !driftLocation ||
        !phaseLocation ||
        !layoutLocation ||
        !ridgeAmpLocation ||
        !cosALocation ||
        !cosBLocation ||
        !cosCLocation ||
        !grainTickLocation
      ) {
        teardownGl();
        return;
      }

      uniforms = {
        resolution: resolutionLocation,
        time: timeLocation,
        mood: moodLocation,
        hardness: hardnessLocation,
        thick: thickLocation,
        drift: driftLocation,
        phase: phaseLocation,
        ridgeAmp: ridgeAmpLocation,
        grainTick: grainTickLocation,
      };

      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      const [br, bg, bb] = fadeTargetRgb(fadeBottom);
      const [tr, tg, tb] = fadeTargetRgb(fadeTop);
      gl.clearColor(br, bg, bb, 1);
      gl.uniform1f(intensityLocation, intensity);
      gl.uniform1f(grainLocation, grain);
      gl.uniform3f(seedLocation, sx, sy, sz);
      gl.uniform1f(fadeTopLocation, fadeTop ? 1 : 0);
      gl.uniform1f(fadeBottomLocation, fadeBottom ? 1 : 0);
      gl.uniform3f(fadeColorTopLocation, tr, tg, tb);
      gl.uniform3f(fadeColorBottomLocation, br, bg, bb);
      gl.uniform2f(layoutLocation, layoutX, layoutY);
      gl.uniform2f(cosALocation, cosA[0], cosA[1]);
      gl.uniform2f(cosBLocation, cosB[0], cosB[1]);
      gl.uniform2f(cosCLocation, cosC[0], cosC[1]);

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      shouldAnimate = animate && !prefersReducedMotion;
      gl.uniform1f(animateLocation, shouldAnimate ? 1 : 0);

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      resize();
      startLoop();
    };

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) {
          initGl();
          startLoop();
          return;
        }
        stopLoop();
      },
      { rootMargin: VISIBLE_ROOT_MARGIN },
    );
    intersection.observe(canvas);

    return () => {
      cancelled = true;
      intersection.disconnect();
      teardownGl();
    };
  }, [animate, fadeBottom, fadeTop, grain, intensity]);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", underlay, className)}
    >
      <canvas
        className={cn("absolute inset-0 size-full ease-out", ready ? "opacity-100" : "opacity-0")}
        ref={canvasRef}
        style={{ transitionDuration: `${REVEAL_MS}ms`, transitionProperty: "opacity" }}
      />
    </div>
  );
};
