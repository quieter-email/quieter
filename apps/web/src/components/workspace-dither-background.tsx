"use client";

import { cn } from "@quieter/ui/cn";
import { useColorModeValue } from "@quieter/ui/color-mode";
import { useEffect, useRef, useState } from "react";
import { effect, frame, init, surface } from "vgpu";
import type { Effect, Gpu, Surface } from "vgpu";

const DITHER_STEP = 3;
const REVEAL_MS = 3000;
/** Defer GPU work until near viewport so hero reveal isn't competing. */
const VISIBLE_ROOT_MARGIN = "160px 0px";

const DITHER_SHADER_SOURCE = `
struct Params {
  resolution: vec2f,
  cssSize: vec2f,
  focusA: vec2f,
  focusB: vec2f,
  fieldDrift: vec2f,
  color: vec3f,
  step: f32,
  dpr: f32,
  alphaScale: f32,
  falloff: f32,
  pattern: f32,
  time: f32,
  animate: f32,
  strengthWave: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hashAt(cell: vec2f) -> f32 {
  return fract(sin(cell.x * 127.1 + cell.y * 311.7) * 43758.5453123);
}

@fragment fn fs_main(
  @builtin(position) fragmentPosition: vec4f,
) -> @location(0) vec4f {
  // WebGPU fragment coordinates use the same top-left origin as the CSS layout.
  let cssPixel = fragmentPosition.xy / params.dpr;
  let columns = ceil(params.cssSize.x / params.step);
  let rows = ceil(params.cssSize.y / params.step);
  let column = floor(cssPixel.x / params.step + 0.5);
  let row = floor(cssPixel.y / params.step + 0.5);
  let t = params.time * params.animate * 0.08;
  let horizontal = column / max(columns, 1.0);
  let vertical = row / max(rows, 1.0);

  // Keep dots off the hard section seams (top and bottom).
  let edgeY = smoothstep(0.0, 0.14, vertical)
    * smoothstep(0.0, 0.14, 1.0 - vertical);
  var baseDensity = 0.0;

  if (params.pattern > 2.5) {
    let dA = abs(vec2f(horizontal, vertical) - params.focusA);
    let dB = abs(vec2f(horizontal, vertical) - params.focusB);
    let distA = max(dA.x, dA.y);
    let distB = max(dB.x, dB.y);
    let densA = pow(
      clamp(1.0 - distA / 0.85, 0.0, 1.0),
      max(params.falloff * 0.4, 0.7),
    );
    let densB = pow(
      clamp(1.0 - distB / 0.85, 0.0, 1.0),
      max(params.falloff * 0.4, 0.7),
    );
    baseDensity = max(densA, densB);
  } else {
    let hx = clamp(horizontal + params.fieldDrift.x, 0.0, 1.0);
    let vy = clamp(vertical + params.fieldDrift.y, 0.0, 1.0);
    let denseBottomLeft = clamp((1.0 - hx + vy) * 0.5, 0.0, 1.0);
    let denseTopRight = clamp((hx + 1.0 - vy) * 0.5, 0.0, 1.0);
    let denseTopLeft = clamp((2.0 - hx - vy) * 0.5, 0.0, 1.0);
    let denseBottomRight = clamp((hx + vy) * 0.5, 0.0, 1.0);

    baseDensity = denseBottomLeft;
    if (params.pattern > 1.5) {
      baseDensity = max(denseTopLeft, denseBottomRight);
    } else if (params.pattern > 0.5) {
      baseDensity = max(denseBottomLeft, denseTopRight);
    }
    baseDensity = pow(baseDensity, params.falloff)
      + sin(hx * 13.5 + vy * 6.5 + t * 0.45) * 0.06
      + sin(hx * 5.5 - vy * 15.0 - t * 0.32) * 0.035;
  }

  let density = clamp(baseDensity, 0.0, 1.0) * edgeY;
  let threshold = density * 1.03 - 0.06;
  if (hashAt(vec2f(column, row)) > threshold) {
    discard;
  }

  let jitter = hashAt(vec2f(column + 53.0, row + 97.0));
  let radius = 0.12 + pow(density, 1.35) * (0.42 + jitter * 0.1);
  let alpha = 0.08 + pow(density, 1.18) * 0.32;
  let center = vec2f(column * params.step, row * params.step);
  let coverage = 1.0 - smoothstep(
    radius - 0.5,
    radius + 0.5,
    distance(cssPixel, center),
  );
  let finalAlpha = min(
    alpha * coverage * params.alphaScale * params.strengthWave,
    1.0,
  );

  return vec4f(params.color * finalAlpha, finalAlpha);
}
`;

type WorkspaceDitherBackgroundProps = {
  /** Slow density/strength drift. Default false. */
  animate?: boolean;
  className?: string;
  dotRgb?: string;
  falloff?: number;
  pattern?: "default" | "leading-corners" | "opposing-corners" | "dual-foci";
  /** Dot grid spacing in CSS px. Default 3; lower = denser. */
  step?: number;
  strength?: number;
};

export const WorkspaceDitherBackground = ({
  animate = false,
  className,
  dotRgb,
  falloff = 1.28,
  pattern = "default",
  step = DITHER_STEP,
  strength,
}: WorkspaceDitherBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const themeDotRgb = useColorModeValue("0, 0, 0", "255, 255, 255");
  const themeStrength = useColorModeValue(2, 0.55);
  const activeDotRgb = dotRgb ?? themeDotRgb;
  const activeStrength = strength ?? themeStrength;
  const gridStep = Math.max(1, step);
  // react-doctor-disable-next-line react-hooks-js/purity -- The timestamp is captured once to keep animation time continuous across effect restarts.
  const sessionRef = useRef({ startedAt: performance.now() });

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- Every observer and animation handle is disconnected or cancelled below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let revealed = false;
    let visible = false;
    let raf = 0;
    let revealFrame: number | null = null;
    let resizeFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let gpu: Gpu | null = null;
    let canvasSurface: Surface | null = null;
    let ditherEffect: Effect | null = null;
    let initialized = false;
    let initializing = false;
    let shouldAnimate = false;
    const { startedAt } = sessionRef.current;

    const reveal = () => {
      if (cancelled || revealed) {
        return;
      }
      revealed = true;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setReady(true);
        return;
      }
      revealFrame = requestAnimationFrame(() => {
        revealFrame = null;
        if (!cancelled) {
          setReady(true);
        }
      });
    };

    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const paint = (timeSeconds: number) => {
      if (!gpu || !canvasSurface || !ditherEffect || !initialized) {
        return;
      }
      const renderGpu = gpu;
      const renderSurface = canvasSurface;
      const renderEffect = ditherEffect;

      const t = timeSeconds * (shouldAnimate ? 1 : 0) * 0.08;
      renderEffect.set({
        params: {
          fieldDrift: [
            Math.sin(t * 0.55) * 0.035 + Math.sin(t * 0.23 + 1.7) * 0.018,
            Math.cos(t * 0.42) * 0.03 + Math.cos(t * 0.31 + 0.8) * 0.015,
          ],
          focusA: [
            0.5 + Math.cos(t * 1.45) * 0.32,
            0.5 + Math.sin(t * 1.2) * 0.26,
          ],
          focusB: [
            0.5 + Math.cos(t * 1.45 + Math.PI) * 0.32,
            0.5 + Math.sin(t * 1.2 + Math.PI) * 0.26,
          ],
          strengthWave: 1 + Math.sin(t * 0.28 + 0.6) * 0.06,
          time: timeSeconds,
        },
      });
      frame(renderGpu, (currentFrame) => {
        currentFrame.pass(
          { clear: [0, 0, 0, 0], target: renderSurface },
          renderEffect
        );
      });
      if (animate && !revealed) {
        reveal();
      }
    };

    const render = (now: number) => {
      paint((now - startedAt) * 0.001);
      raf = requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (
        !shouldAnimate ||
        raf !== 0 ||
        !visible ||
        cancelled ||
        !initialized
      ) {
        return;
      }
      raf = requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      if (!shouldAnimate) {
        return;
      }
      if (document.hidden || !visible) {
        stopLoop();
        return;
      }
      startLoop();
    };

    const scheduleResize = () => {
      if (resizeFrame !== null) {
        return;
      }
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (animate && !visible) {
          return;
        }
        paint(shouldAnimate ? (performance.now() - startedAt) * 0.001 : 0);
      });
    };

    const initGpu = async () => {
      if (cancelled || initializing || initialized) {
        return;
      }
      initializing = true;
      const nextGpu = await init({ powerPreference: "high-performance" });
      if (cancelled) {
        nextGpu.dispose();
        return;
      }
      gpu = nextGpu;
      const nextSurface = surface(nextGpu, canvas, {
        alphaMode: "premultiplied",
        dpr: [1, 2],
        label: "workspace-dither-surface",
      });
      canvasSurface = nextSurface;

      const [red, green, blue] = activeDotRgb
        .split(",")
        .map((channel) => Number(channel.trim()) / 255);
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      shouldAnimate = animate && !prefersReducedMotion;
      const nextEffect = effect(nextGpu, DITHER_SHADER_SOURCE, {
        blend: "premultiplied",
        label: "workspace-dither",
        set: {
          params: {
            alphaScale: activeStrength,
            animate: shouldAnimate ? 1 : 0,
            color: [red || 0, green || 0, blue || 0],
            cssSize: [1, 1],
            dpr: 1,
            falloff,
            fieldDrift: [0, 0],
            focusA: [0.82, 0.5],
            focusB: [0.18, 0.5],
            pattern: {
              default: 0,
              "dual-foci": 3,
              "leading-corners": 2,
              "opposing-corners": 1,
            }[pattern],
            resolution: [1, 1],
            step: gridStep,
            strengthWave: 1,
            time: 0,
          },
        },
      });
      ditherEffect = nextEffect;
      nextSurface.onResize(({ dpr, height, width }) => {
        nextEffect.set({
          params: {
            cssSize: [width / dpr, height / dpr],
            dpr,
            resolution: [width, height],
          },
        });
      });

      let compilePromise = Promise.resolve(nextEffect);
      frame(nextGpu, () => {
        compilePromise = nextEffect.compile(nextSurface);
      });
      await compilePromise;
      if (cancelled) {
        nextGpu.dispose();
        return;
      }

      initialized = true;
      initializing = false;
      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(canvas);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      if (!animate || visible) {
        paint(shouldAnimate ? (performance.now() - startedAt) * 0.001 : 0);
        startLoop();
      }
    };

    const startGpu = async () => {
      try {
        await initGpu();
      } catch {
        initializing = false;
        canvasSurface?.dispose();
        gpu?.dispose();
        gpu = null;
        canvasSurface = null;
        ditherEffect = null;
      }
    };

    if (animate) {
      const intersection = new IntersectionObserver(
        ([entry]) => {
          visible = entry?.isIntersecting ?? false;
          if (visible) {
            void startGpu();
            if (initialized) {
              paint(
                shouldAnimate ? (performance.now() - startedAt) * 0.001 : 0
              );
            }
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
        stopLoop();
        resizeObserver?.disconnect();
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame);
        }
        if (revealFrame !== null) {
          cancelAnimationFrame(revealFrame);
        }
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
        canvasSurface?.dispose();
        gpu?.dispose();
      };
    }

    visible = true;
    void startGpu();
    return () => {
      cancelled = true;
      stopLoop();
      resizeObserver?.disconnect();
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
      if (revealFrame !== null) {
        cancelAnimationFrame(revealFrame);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      canvasSurface?.dispose();
      gpu?.dispose();
    };
  }, [activeDotRgb, activeStrength, animate, falloff, gridStep, pattern]);

  return (
    <canvas
      className={cn(
        "pointer-events-none absolute inset-0 z-0 size-full overflow-hidden opacity-25 ease-out dark:opacity-100",
        className,
        animate && !ready && "opacity-0"
      )}
      ref={canvasRef}
      style={
        animate
          ? {
              transitionDuration: `${REVEAL_MS}ms`,
              transitionProperty: "opacity",
            }
          : undefined
      }
    />
  );
};
