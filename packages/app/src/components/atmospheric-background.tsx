"use client";

import { cn } from "@quieter/ui/cn";
import { useEffect, useReducer, useRef, useState } from "react";
import { effect, frame, init, surface } from "vgpu";
import type { Effect, Gpu, Surface } from "vgpu";

import atmosphericShaderSource from "./atmospheric-background.wgsl";

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

/** Matches dark `--bg` (oklch 0.145). */
// sRGB channels for the app canvas; --bg is oklch(0.125) => #060606.
const CANVAS_RGB = [0.0252, 0.0252, 0.0252] as const;
const BLACK_RGB = [0, 0, 0] as const;

type FadeTarget = "black" | "canvas";

type AtmosphericBackgroundProps = {
  interactive?: boolean;
  className?: string;
  /** Texture in the light field. Default 1. */
  grain?: number;
  variant?: "default" | "closing";
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
  pointer: [number, number];
  pointerStrength: number;
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
  closing: number;
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
  interactive = false,
  danger,
  variant = "default",
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
    let pointerX = 0.5;
    let pointerY = 0.5;
    let pointerStrength = 0;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
      pointerStrength = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? 1 : 0;
      if (pointerStrength > 0) {
        pointerX = x;
        pointerY = y;
      }
    };
    const handlePointerBlur = () => {
      pointerStrength = 0;
    };
    if (interactive && shouldAnimate) {
      window.addEventListener("pointermove", handlePointerMove, {
        passive: true,
      });
      window.addEventListener("blur", handlePointerBlur);
    }
    const [sx, sy, sz] = session.seed;
    const closing = variant === "closing";
    const motionSpeed = closing ? 0.7 : 1;

    const layoutX = f32(f32(sx - 0.5) * 0.55);
    const layoutY = f32(f32(sy - 0.5) * 0.55 - (closing ? 0.12 : 0));
    const angA = f32((closing ? 0.34 : -0.22) + f32(sx - 0.5) * 0.55);
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
      const shaderTime = timeSeconds * motionSpeed;
      const g = computeFrameGlobals(shaderTime, shouldAnimate, session.seed);
      shaderParams.time = shaderTime;
      shaderParams.mood = g.mood;
      shaderParams.hardness = g.hardness;
      shaderParams.thick = g.thick;
      shaderParams.drift = [g.drift, g.drift2];
      shaderParams.phase = [g.phaseA, g.phaseB, g.phaseC];
      shaderParams.ridgeAmp = [g.ridgeAmpB, g.ridgeAmpC];
      shaderParams.pointer[0] += (pointerX - shaderParams.pointer[0]) * 0.06;
      shaderParams.pointer[1] += (pointerY - shaderParams.pointer[1]) * 0.06;
      shaderParams.pointerStrength +=
        (pointerStrength - shaderParams.pointerStrength) * 0.05;
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
          session.timeOffset * motionSpeed,
          shouldAnimate,
          session.seed
        );
        shaderParams = {
          animate: shouldAnimate ? 1 : 0,
          closing: closing ? 1 : 0,
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
          hardness: initialGlobals.hardness,
          intensity,
          layoutOffset: [layoutX, layoutY],
          mood: initialGlobals.mood,
          phase: [
            initialGlobals.phaseA,
            initialGlobals.phaseB,
            initialGlobals.phaseC,
          ],
          pointer: [0.5, 0.5],
          pointerStrength: 0,
          resolution: [nextSurface.size[0], nextSurface.size[1]],
          ridgeAmp: [initialGlobals.ridgeAmpB, initialGlobals.ridgeAmpC],
          seed: session.seed,
          thick: initialGlobals.thick,
          time: session.timeOffset * motionSpeed,
        };
        atmosphericEffect = effect(nextGpu, atmosphericShaderSource, {
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
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", handlePointerBlur);
      teardownGpu();
    };
  }, [
    animate,
    danger,
    fadeBottom,
    fadeTop,
    grain,
    intensity,
    interactive,
    session,
    variant,
  ]);

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
        className={cn("absolute inset-0 size-full ease-out", {
          "opacity-0": !ready,
          "opacity-100": ready,
        })}
        ref={canvasRef}
        style={{
          // oxlint-disable-next-line shadcn/no-inline-styles -- Reveal timing is computed from constants.
          transitionDuration: `${REVEAL_MS}ms`,
          // oxlint-disable-next-line shadcn/no-inline-styles -- Reveal timing is computed from constants.
          transitionProperty: "opacity",
        }}
      />
    </div>
  );
};
