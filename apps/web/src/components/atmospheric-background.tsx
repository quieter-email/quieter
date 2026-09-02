"use client";

import { cn } from "@quieter/ui/cn";
import { useEffect, useReducer, useRef, useState } from "react";
import { effect, frame, init, surface } from "vgpu";
import type { Effect, Gpu, Surface } from "vgpu";

/**
 * Atmospheric background — soft light fields + curved highlight ridges with
 * noise-driven mood. Charcoal / navy / off-white, quiet grain (no flickering
 * vignette). QUIETER-176. Opt in on branded surfaces; `fadeTop` / `fadeBottom`
 * settle into black or elevated at hard section cuts.
 *
 * Perf: full visual fidelity (DPR <= 2). Per-frame globals run once on the CPU;
 * WebGPU init + RAF only while near the viewport.
 */

const REVEAL_MS = 3000;
/** Start compiling slightly before scroll-in so below-fold sections are ready. */
const VISIBLE_ROOT_MARGIN = "120px 0px";

/**
 * Spatial field only — mood/drift/phases/angles arrive as uniforms so every
 * pixel does not recompute the same global noise and ridge rotations.
 */
const ATMOSPHERIC_SHADER_SOURCE = `
struct Params {
  resolution: vec2f,
  time: f32,
  intensity: f32,
  grain: f32,
  animate: f32,
  seed: vec3f,
  fadeTop: f32,
  fadeBottom: f32,
  fadeColorTop: vec3f,
  fadeColorBottom: vec3f,
  danger: f32,
  mood: f32,
  hardness: f32,
  thick: f32,
  drift: vec2f,
  phase: vec3f,
  layoutOffset: vec2f,
  ridgeAmp: vec2f,
  cosA: vec2f,
  cosB: vec2f,
  cosC: vec2f,
  grainTick: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash13(input: vec3f) -> f32 {
  var p = fract(input * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn valueNoise3(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i);
  let n100 = hash13(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3f(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, f.x);
  let nx10 = mix(n010, n110, f.x);
  let nx01 = mix(n001, n101, f.x);
  let nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

fn softGlow(p: vec2f, center: vec2f, radius: vec2f) -> f32 {
  let d = (p - center) / radius;
  return exp(-dot(d, d));
}

fn ridge(p: vec2f, phase: f32, thickness: f32, hard: f32, cs: vec2f, freq: f32) -> f32 {
  let ca = cs.x;
  let sa = cs.y;
  let r = vec2f(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  let fold =
    r.y
    - (
      -0.1
      + 0.3 * sin(r.x * (1.15 * freq) + phase)
      + 0.12 * sin(r.x * (2.35 * freq) + phase * 1.7)
      + 0.05 * sin(r.x * (4.2 * freq) - phase * 0.65)
    );
  let soft = exp(-(fold * fold) / max(thickness * thickness, 0.0001));
  let sharp = mix(0.45, 7.0, clamp(hard, 0.0, 1.0));
  return pow(soft, sharp);
}

fn layerLight(a: f32, b: f32) -> f32 {
  return a + b * (1.0 - a);
}

@fragment fn fs_main(@location(0) inputUv: vec2f) -> @location(0) vec4f {
  let uv = vec2f(inputUv.x, 1.0 - inputUv.y);
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let t = params.time * params.animate * 0.095 + params.seed.x * 40.0;

  let mood = params.mood;
  let hardness = params.hardness;
  let drift = params.drift.x;
  let drift2 = params.drift.y;
  let q = p - params.layoutOffset;

  var ambient =
    softGlow(q, vec2f(-0.25 + drift, -0.06 + drift2), vec2f(1.2, 0.8)) * 0.4 +
    softGlow(q, vec2f(0.3 - drift2, 0.08 + drift), vec2f(0.95, 0.65)) * 0.28;

  var blueField =
    softGlow(q, vec2f(0.5 + drift2, 0.0 - drift), vec2f(0.55, 0.4)) * 0.75 +
    softGlow(q, vec2f(0.18 - drift, -0.28), vec2f(0.36, 0.28)) * 0.45 +
    softGlow(q, vec2f(-0.55 + drift, 0.22), vec2f(0.34, 0.26)) * mix(0.2, 0.55, mood) +
    softGlow(q, vec2f(0.72 + drift * 0.4, 0.32), vec2f(0.28, 0.22)) * 0.35 +
    softGlow(q, vec2f(-0.2 - drift2, -0.4), vec2f(0.4, 0.2)) * 0.3;
  let blueBreak =
    valueNoise3(vec3f(q * 2.4 + drift, t * 0.14 + params.seed.y)) * 0.55
    + valueNoise3(vec3f(q * 5.2 - drift2, t * 0.1 + params.seed.z + 2.0)) * 0.35;
  let blueHole = softGlow(q, vec2f(-0.05 + drift2, 0.08), vec2f(0.55, 0.35)) * 0.4;
  blueField *= mix(0.35, 1.15, blueBreak);
  blueField *= 1.0 - blueHole * mix(0.25, 0.55, 1.0 - mood);
  blueField = clamp(blueField, 0.0, 1.0);

  let thick = params.thick;
  let ridgeMain = ridge(
    q + vec2f(drift * 0.5, drift2),
    params.phase.x,
    thick,
    hardness,
    params.cosA,
    0.95
  );
  let ridgeB = ridge(
    q * vec2f(1.08, 0.94) + vec2f(0.32, -0.2),
    params.phase.y,
    thick * 1.12,
    hardness,
    params.cosB,
    0.68
  );
  let ridgeC = ridge(
    q * vec2f(0.9, 1.14) + vec2f(-0.36, 0.22),
    params.phase.z,
    thick * 0.88,
    hardness,
    params.cosC,
    1.4
  );

  let bloom =
    softGlow(q, vec2f(-0.34 + drift, -0.1 + drift2), vec2f(0.58, 0.24)) * 0.6 +
    softGlow(q, vec2f(-0.02 + drift2, 0.1), vec2f(0.36, 0.17)) * 0.4;

  let ridgeLayer = layerLight(
    ridgeMain * 0.75,
    layerLight(ridgeB * params.ridgeAmp.x, ridgeC * params.ridgeAmp.y)
  );
  var highlight = layerLight(ridgeLayer, bloom * 0.55);
  highlight = clamp(highlight * params.intensity, 0.0, 1.0);

  let valley =
    softGlow(q, vec2f(0.1 + drift, -0.02), vec2f(0.4, 0.16)) * 0.65 +
    softGlow(q, vec2f(-0.42, 0.2), vec2f(0.28, 0.12)) * 0.4;
  highlight *= 1.0 - valley * mix(0.35, 0.55, mood);

  let textSafe = softGlow(p, vec2f(0.0, 0.02), vec2f(0.7, 0.36));
  highlight *= mix(1.0, 0.3, textSafe * 0.9);
  ambient *= mix(1.0, 0.6, textSafe * 0.65);

  let black = vec3f(0.0);
  let charcoal = mix(vec3f(0.045, 0.05, 0.06), vec3f(0.052, 0.032, 0.034), params.danger);
  let navy = mix(vec3f(0.07, 0.09, 0.13), vec3f(0.14, 0.04, 0.05), params.danger);
  let dustyBlue = mix(vec3f(0.15, 0.19, 0.27), vec3f(0.3, 0.08, 0.09), params.danger);
  let steel = mix(vec3f(0.32, 0.36, 0.42), vec3f(0.4, 0.26, 0.26), params.danger);
  let offWhite = mix(vec3f(0.8, 0.82, 0.86), vec3f(0.84, 0.78, 0.77), params.danger);

  let blueAmt = mix(0.4, 0.85, mood) * mix(1.0, 1.12, params.danger);
  let blueTone = valueNoise3(vec3f(q * 1.6 + params.seed.xy, t * 0.12));
  var color = mix(black, charcoal, clamp(ambient + 0.3, 0.0, 1.0));
  color = mix(color, navy, clamp(blueField * 0.65 * blueAmt * mix(0.7, 1.15, blueTone), 0.0, 1.0));
  color = mix(
    color,
    dustyBlue,
    clamp(blueField * 0.28 * blueAmt * mix(0.5, 1.2, 1.0 - blueTone), 0.0, 1.0)
  );
  color = mix(color, steel, smoothstep(0.12, 0.5, highlight) * 0.55);
  color = mix(color, offWhite, pow(smoothstep(0.32, 0.92, highlight), mix(1.5, 2.3, hardness)));

  let side = min(uv.x, 1.0 - uv.x);
  let fromTop = 1.0 - uv.y;
  let edgeMask = smoothstep(0.0, 0.1, side) * smoothstep(0.0, 0.14, fromTop);
  color *= mix(0.88, 1.0, edgeMask);

  if (params.fadeBottom > 0.5) {
    color = mix(params.fadeColorBottom, color, smoothstep(0.0, 0.16, uv.y));
  }
  if (params.fadeTop > 0.5) {
    color = mix(params.fadeColorTop, color, smoothstep(0.0, 0.16, 1.0 - uv.y));
  }

  let fragCoord = uv * params.resolution;
  let gn = hash12(fragCoord + params.grainTick * 17.0);
  let luma = dot(color, vec3f(0.299, 0.587, 0.114));
  color += (gn - 0.5) * mix(0.02, 0.045, smoothstep(0.02, 0.3, luma)) * params.grain;

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

/** Matches dark `--bg` (oklch 0.145). */
// sRGB channels for the app canvas; --bg is oklch(0.125) => #060606.
const CANVAS_RGB = [0.0252, 0.0252, 0.0252] as const;
const BLACK_RGB = [0, 0, 0] as const;

type FadeTarget = "black" | "canvas";

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
  /** Deep red atmosphere (errors). Default false. */
  danger?: boolean;
};

const fadeTargetRgb = (target: FadeTarget | undefined) =>
  target === "canvas" ? CANVAS_RGB : BLACK_RGB;

const f32 = Math.fround;

const fract = (value: number) => f32(value - Math.floor(value));

const hash13 = (x: number, y: number, z: number) => {
  let px = fract(f32(x * 0.1031));
  let py = fract(f32(y * 0.1031));
  let pz = fract(f32(z * 0.1031));
  const dot = f32(
    px * f32(pz + 31.32) + py * f32(py + 31.32) + pz * f32(px + 31.32)
  );
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
  seed: readonly [number, number, number]
): FrameGlobals => {
  const [sx, sy, sz] = seed;
  const t = f32(f32(timeSeconds * (animate ? 1 : 0) * 0.095) + f32(sx * 40));

  const mood = valueNoise3(f32(t * 0.22), sy, f32(t * 0.16));
  const detail = valueNoise3(f32(sz + 1.2), f32(t * 0.2), f32(t * 0.18));
  const hardnessNoise = valueNoise3(f32(t * 0.07 + sx), 2.1, sy);
  const hardness = mix(0.05, 0.55, smoothstep(0.42, 0.58, hardnessNoise));
  const drift = f32(f32(valueNoise3(f32(t * 0.4), sy, 1) - 0.5) * 0.18);
  const drift2 = f32(f32(valueNoise3(sz, f32(t * 0.38), 2) - 0.5) * 0.15);
  const thickNoise = valueNoise3(f32(t * 0.08 + sz), 3.7, sy);
  const thick = f32(mix(0.2, 0.3, thickNoise) * mix(1, 0.9, hardness));

  return {
    detail,
    drift,
    drift2,
    grainTick: animate
      ? Math.floor(f32(timeSeconds * 3 + sx * 100))
      : f32(sx * 100),
    hardness,
    mood,
    phaseA: f32(f32(sx * 6.28318) + f32(t * 1.42)),
    phaseB: f32(f32(sy * 6.28318) + f32(t * 0.58) + 2.4),
    phaseC: f32(f32(sz * 6.28318) - f32(t * 1.95) - 1.1),
    ridgeAmpB: mix(0.12, 0.42, detail),
    ridgeAmpC: mix(0.03, 0.32, detail),
    thick,
  };
};

type AtmosphericShaderParams = {
  resolution: [number, number];
  time: number;
  intensity: number;
  grain: number;
  animate: number;
  seed: [number, number, number];
  fadeTop: number;
  fadeBottom: number;
  fadeColorTop: readonly [number, number, number];
  fadeColorBottom: readonly [number, number, number];
  danger: number;
  mood: number;
  hardness: number;
  thick: number;
  drift: [number, number];
  phase: [number, number, number];
  layoutOffset: [number, number];
  ridgeAmp: [number, number];
  cosA: [number, number];
  cosB: [number, number];
  cosC: [number, number];
  grainTick: number;
};

type AtmosphericSession = {
  seed: [number, number, number];
  startedAt: number;
  timeOffset: number;
};

const createAtmosphericSession = (): AtmosphericSession => ({
  seed: [Math.random(), Math.random(), Math.random()],
  startedAt: performance.now(),
  timeOffset: Math.random() * 120,
});

export const AtmosphericBackground = ({
  animate = true,
  className,
  fadeBottom,
  fadeTop,
  grain = 1,
  intensity = 1,
  danger,
}: AtmosphericBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const underlay = fadeBottom === "canvas" ? "bg-bg" : "bg-black";
  const [session] = useReducer(
    (current: AtmosphericSession) => current,
    undefined,
    createAtmosphericSession
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let revealed = false;
    let visible = false;
    let raf = 0;
    let initializing = false;
    let resizeObserver: ResizeObserver | null = null;
    let gpuContext: Gpu | null = null;
    let canvasSurface: Surface | null = null;
    let atmosphericEffect: Effect | null = null;
    let shaderParams: AtmosphericShaderParams | null = null;
    let unsubscribeResize: (() => void) | null = null;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const shouldAnimate = animate && !prefersReducedMotion;
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
      if (cancelled || revealed) {
        return;
      }
      revealed = true;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setReady(true);
        return;
      }
      requestAnimationFrame(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    };

    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const draw = (timeSeconds: number) => {
      if (!(gpuContext && canvasSurface && atmosphericEffect && shaderParams)) {
        return;
      }
      const g = computeFrameGlobals(timeSeconds, shouldAnimate, session.seed);
      shaderParams.time = timeSeconds;
      shaderParams.mood = g.mood;
      shaderParams.hardness = g.hardness;
      shaderParams.thick = g.thick;
      shaderParams.drift = [g.drift, g.drift2];
      shaderParams.phase = [g.phaseA, g.phaseB, g.phaseC];
      shaderParams.ridgeAmp = [g.ridgeAmpB, g.ridgeAmpC];
      shaderParams.grainTick = g.grainTick;
      const currentGpu = gpuContext;
      const currentSurface = canvasSurface;
      const currentEffect = atmosphericEffect;
      currentEffect.set({ params: shaderParams });
      frame(currentGpu, (currentFrame) => {
        currentFrame.pass(currentSurface, currentEffect);
      });
    };

    const render = (now: number) => {
      draw((now - session.startedAt) * 0.001 + session.timeOffset);
      if (!revealed) {
        reveal();
      }
      raf = requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (
        !shouldAnimate ||
        raf !== 0 ||
        !visible ||
        document.hidden ||
        cancelled ||
        !atmosphericEffect
      ) {
        return;
      }
      raf = requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      if (document.hidden || !visible) {
        stopLoop();
        return;
      }
      startLoop();
    };

    const teardownGpu = () => {
      stopLoop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribeResize?.();
      unsubscribeResize = null;
      canvasSurface?.dispose();
      gpuContext?.dispose();
      atmosphericEffect = null;
      canvasSurface = null;
      shaderParams = null;
      gpuContext = null;
    };

    const initGpu = async () => {
      if (cancelled || gpuContext || initializing) {
        return;
      }
      initializing = true;
      const [br, bg, bb] = fadeTargetRgb(fadeBottom);
      const [tr, tg, tb] = fadeTargetRgb(fadeTop);
      try {
        const nextGpu = await init({ powerPreference: "high-performance" });
        if (cancelled) {
          nextGpu.dispose();
          return;
        }

        gpuContext = nextGpu;
        const nextSurface = surface(nextGpu, canvas, {
          dpr: [1, 2],
          label: "atmospheric-background",
        });
        canvasSurface = nextSurface;
        const initialGlobals = computeFrameGlobals(
          session.timeOffset,
          shouldAnimate,
          session.seed
        );
        shaderParams = {
          animate: shouldAnimate ? 1 : 0,
          cosA,
          cosB,
          cosC,
          danger: danger === true ? 1 : 0,
          drift: [initialGlobals.drift, initialGlobals.drift2],
          fadeBottom: fadeBottom ? 1 : 0,
          fadeColorBottom: [br, bg, bb],
          fadeColorTop: [tr, tg, tb],
          fadeTop: fadeTop ? 1 : 0,
          grain,
          grainTick: initialGlobals.grainTick,
          hardness: initialGlobals.hardness,
          intensity,
          layoutOffset: [layoutX, layoutY],
          mood: initialGlobals.mood,
          phase: [
            initialGlobals.phaseA,
            initialGlobals.phaseB,
            initialGlobals.phaseC,
          ],
          resolution: [nextSurface.size[0], nextSurface.size[1]],
          ridgeAmp: [initialGlobals.ridgeAmpB, initialGlobals.ridgeAmpC],
          seed: session.seed,
          thick: initialGlobals.thick,
          time: session.timeOffset,
        };
        atmosphericEffect = effect(nextGpu, ATMOSPHERIC_SHADER_SOURCE, {
          label: "atmospheric-background",
          set: { params: shaderParams },
        });
        let compilation: ReturnType<Effect["compile"]> | undefined;
        frame(nextGpu, () => {
          compilation = atmosphericEffect?.compile(nextSurface);
        });
        if (!compilation) {
          throw new Error("Failed to start atmospheric pipeline compilation");
        }
        await compilation;
        if (cancelled) {
          return;
        }

        unsubscribeResize = nextSurface.onResize(({ width, height }) => {
          if (shaderParams) {
            shaderParams.resolution = [width, height];
          }
        });
        resizeObserver = new ResizeObserver(() => {
          draw(
            shouldAnimate
              ? (performance.now() - session.startedAt) * 0.001 +
                  session.timeOffset
              : session.timeOffset
          );
          reveal();
        });
        resizeObserver.observe(canvas);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        draw(
          shouldAnimate
            ? (performance.now() - session.startedAt) * 0.001 +
                session.timeOffset
            : session.timeOffset
        );
        reveal();
        startLoop();
      } catch {
        teardownGpu();
      } finally {
        initializing = false;
      }
    };

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) {
          void initGpu();
          startLoop();
          return;
        }
        stopLoop();
      },
      { rootMargin: VISIBLE_ROOT_MARGIN }
    );
    intersection.observe(canvas);

    return () => {
      cancelled = true;
      intersection.disconnect();
      teardownGpu();
    };
  }, [animate, danger, fadeBottom, fadeTop, grain, intensity, session]);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        underlay,
        className
      )}
    >
      <canvas
        className={cn(
          "absolute inset-0 size-full ease-out",
          ready ? "opacity-100" : "opacity-0"
        )}
        ref={canvasRef}
        style={{
          transitionDuration: `${REVEAL_MS}ms`,
          transitionProperty: "opacity",
        }}
      />
    </div>
  );
};
