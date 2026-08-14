"use client";

import { cn } from "@quieter/ui/cn";
import { useColorModeValue } from "@quieter/ui/color-mode";
import { useEffect, useRef, useState } from "react";

const DITHER_STEP = 3;
const MAX_PIXEL_RATIO = 2;
const REVEAL_MS = 3000;
/** Defer GL work until near viewport so hero reveal isn't competing. */
const VISIBLE_ROOT_MARGIN = "160px 0px";

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform vec2 uResolution;
uniform vec2 uCssSize;
uniform float uStep;
uniform float uDpr;
uniform vec3 uColor;
uniform float uAlphaScale;
uniform float uFalloff;
uniform float uPattern;
uniform float uTime;
uniform float uAnimate;
uniform float uStrengthWave;
uniform vec2 uFocusA;
uniform vec2 uFocusB;
uniform vec2 uFieldDrift;

float hashAt(vec2 cell) {
  return fract(sin(cell.x * 127.1 + cell.y * 311.7) * 43758.5453123);
}

void main() {
  // gl_FragCoord has its origin at the bottom-left in device pixels; convert to a
  // top-left CSS-pixel space so the gradient matches the original 2D canvas math.
  vec2 cssPixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uDpr;

  float columns = ceil(uCssSize.x / uStep);
  float rows = ceil(uCssSize.y / uStep);
  float column = floor(cssPixel.x / uStep + 0.5);
  float row = floor(cssPixel.y / uStep + 0.5);

  float t = uTime * uAnimate * 0.08;

  float horizontal = column / max(columns, 1.0);
  float vertical = row / max(rows, 1.0);

  // Keep dots off the hard section seams (top + bottom)
  float edgeY = smoothstep(0.0, 0.14, vertical) * smoothstep(0.0, 0.14, 1.0 - vertical);

  float baseDensity = 0.0;

  if (uPattern > 2.5) {
    // Two density foci — positions computed once per frame on the CPU
    vec2 dA = abs(vec2(horizontal, vertical) - uFocusA);
    vec2 dB = abs(vec2(horizontal, vertical) - uFocusB);
    float distA = max(dA.x, dA.y);
    float distB = max(dB.x, dB.y);
    float densA = pow(clamp(1.0 - distA / 0.85, 0.0, 1.0), max(uFalloff * 0.4, 0.7));
    float densB = pow(clamp(1.0 - distB / 0.85, 0.0, 1.0), max(uFalloff * 0.4, 0.7));
    baseDensity = max(densA, densB);
  } else {
    float hx = clamp(horizontal + uFieldDrift.x, 0.0, 1.0);
    float vy = clamp(vertical + uFieldDrift.y, 0.0, 1.0);

    // Four corner ramps. uPattern: 0 = BL, 1 = BL+TR, 2 = TL+BR
    float denseBottomLeft = clamp((1.0 - hx + vy) * 0.5, 0.0, 1.0);
    float denseTopRight = clamp((hx + 1.0 - vy) * 0.5, 0.0, 1.0);
    float denseTopLeft = clamp((2.0 - hx - vy) * 0.5, 0.0, 1.0);
    float denseBottomRight = clamp((hx + vy) * 0.5, 0.0, 1.0);

    baseDensity = denseBottomLeft;
    if (uPattern > 1.5) {
      baseDensity = max(denseTopLeft, denseBottomRight);
    } else if (uPattern > 0.5) {
      baseDensity = max(denseBottomLeft, denseTopRight);
    }
    baseDensity =
      pow(baseDensity, uFalloff)
      + sin(hx * 13.5 + vy * 6.5 + t * 0.45) * 0.06
      + sin(hx * 5.5 - vy * 15.0 - t * 0.32) * 0.035;
  }

  float density = clamp(baseDensity, 0.0, 1.0) * edgeY;
  float threshold = density * 1.03 - 0.06;

  if (hashAt(vec2(column, row)) > threshold) {
    discard;
  }

  float jitter = hashAt(vec2(column + 53.0, row + 97.0));
  float radius = 0.12 + pow(density, 1.35) * (0.42 + jitter * 0.1);
  float alpha = 0.08 + pow(density, 1.18) * 0.32;

  vec2 center = vec2(column * uStep, row * uStep);
  float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, distance(cssPixel, center));
  float finalAlpha = min(alpha * coverage * uAlphaScale * uStrengthWave, 1.0);

  gl_FragColor = vec4(uColor * finalAlpha, finalAlpha);
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

const compileShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string
) => {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }

  return shader;
};

type WorkspaceGlLocations = {
  alphaScale: WebGLUniformLocation | null;
  animate: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  cssSize: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
  falloff: WebGLUniformLocation | null;
  fieldDrift: WebGLUniformLocation | null;
  focusA: WebGLUniformLocation | null;
  focusB: WebGLUniformLocation | null;
  pattern: WebGLUniformLocation | null;
  position: number;
  resolution: WebGLUniformLocation | null;
  step: WebGLUniformLocation | null;
  strengthWave: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
};

type ReadyWorkspaceGlLocations = {
  alphaScale: WebGLUniformLocation;
  animate: WebGLUniformLocation;
  color: WebGLUniformLocation;
  cssSize: WebGLUniformLocation;
  dpr: WebGLUniformLocation;
  falloff: WebGLUniformLocation;
  fieldDrift: WebGLUniformLocation;
  focusA: WebGLUniformLocation;
  focusB: WebGLUniformLocation;
  pattern: WebGLUniformLocation;
  position: number;
  resolution: WebGLUniformLocation;
  step: WebGLUniformLocation;
  strengthWave: WebGLUniformLocation;
  time: WebGLUniformLocation;
};

const getWorkspaceGlLocations = (
  gl: WebGLRenderingContext,
  program: WebGLProgram
): WorkspaceGlLocations => ({
  alphaScale: gl.getUniformLocation(program, "uAlphaScale"),
  animate: gl.getUniformLocation(program, "uAnimate"),
  color: gl.getUniformLocation(program, "uColor"),
  cssSize: gl.getUniformLocation(program, "uCssSize"),
  dpr: gl.getUniformLocation(program, "uDpr"),
  falloff: gl.getUniformLocation(program, "uFalloff"),
  fieldDrift: gl.getUniformLocation(program, "uFieldDrift"),
  focusA: gl.getUniformLocation(program, "uFocusA"),
  focusB: gl.getUniformLocation(program, "uFocusB"),
  pattern: gl.getUniformLocation(program, "uPattern"),
  position: gl.getAttribLocation(program, "aPosition"),
  resolution: gl.getUniformLocation(program, "uResolution"),
  step: gl.getUniformLocation(program, "uStep"),
  strengthWave: gl.getUniformLocation(program, "uStrengthWave"),
  time: gl.getUniformLocation(program, "uTime"),
});

const hasWorkspaceGlLocations = (
  locations: WorkspaceGlLocations
): locations is ReadyWorkspaceGlLocations =>
  locations.position !== -1 &&
  [
    locations.alphaScale,
    locations.animate,
    locations.color,
    locations.cssSize,
    locations.dpr,
    locations.falloff,
    locations.fieldDrift,
    locations.focusA,
    locations.focusB,
    locations.pattern,
    locations.resolution,
    locations.step,
    locations.strengthWave,
    locations.time,
  ].every((location) => location !== null);

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

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- ResizeObserver and every animation handle are disconnected or cancelled below.
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
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let vertexShader: WebGLShader | null = null;
    let fragmentShader: WebGLShader | null = null;
    let positionBuffer: WebGLBuffer | null = null;
    let resolutionLocation: WebGLUniformLocation | null = null;
    let cssSizeLocation: WebGLUniformLocation | null = null;
    let dprLocation: WebGLUniformLocation | null = null;
    let timeLocation: WebGLUniformLocation | null = null;
    let strengthWaveLocation: WebGLUniformLocation | null = null;
    let focusALocation: WebGLUniformLocation | null = null;
    let focusBLocation: WebGLUniformLocation | null = null;
    let fieldDriftLocation: WebGLUniformLocation | null = null;
    let shouldAnimate = false;
    let lastDeviceHeight = 0;
    let lastDeviceWidth = 0;
    let cssWidth = 0;
    let cssHeight = 0;
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
      if (
        !gl ||
        !timeLocation ||
        !strengthWaveLocation ||
        !focusALocation ||
        !focusBLocation ||
        !fieldDriftLocation ||
        !cssWidth ||
        !cssHeight
      ) {
        return;
      }

      const t = timeSeconds * (shouldAnimate ? 1 : 0) * 0.08;
      const strengthWave = 1 + Math.sin(t * 0.28 + 0.6) * 0.06;
      const focusAx = 0.5 + Math.cos(t * 1.45) * 0.32;
      const focusAy = 0.5 + Math.sin(t * 1.2) * 0.26;
      const focusBx = 0.5 + Math.cos(t * 1.45 + Math.PI) * 0.32;
      const focusBy = 0.5 + Math.sin(t * 1.2 + Math.PI) * 0.26;
      const driftX =
        Math.sin(t * 0.55) * 0.035 + Math.sin(t * 0.23 + 1.7) * 0.018;
      const driftY =
        Math.cos(t * 0.42) * 0.03 + Math.cos(t * 0.31 + 0.8) * 0.015;

      gl.uniform1f(timeLocation, timeSeconds);
      gl.uniform1f(strengthWaveLocation, strengthWave);
      gl.uniform2f(focusALocation, focusAx, focusAy);
      gl.uniform2f(focusBLocation, focusBx, focusBy);
      gl.uniform2f(fieldDriftLocation, driftX, driftY);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (animate && !revealed) {
        reveal();
      }
    };

    const resize = () => {
      resizeFrame = null;
      if (
        !gl ||
        !resolutionLocation ||
        !cssSizeLocation ||
        !dprLocation ||
        cancelled
      ) {
        return;
      }
      const { height, width } = canvas.getBoundingClientRect();
      if (!height || !width) {
        return;
      }

      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_PIXEL_RATIO
      );
      const deviceWidth = Math.ceil(width * pixelRatio);
      const deviceHeight = Math.ceil(height * pixelRatio);
      cssWidth = width;
      cssHeight = height;

      if (
        deviceWidth !== lastDeviceWidth ||
        deviceHeight !== lastDeviceHeight
      ) {
        lastDeviceWidth = deviceWidth;
        lastDeviceHeight = deviceHeight;
        if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
          canvas.width = deviceWidth;
          canvas.height = deviceHeight;
        }
        gl.viewport(0, 0, deviceWidth, deviceHeight);
        gl.uniform2f(resolutionLocation, deviceWidth, deviceHeight);
        gl.uniform2f(cssSizeLocation, width, height);
        gl.uniform1f(dprLocation, pixelRatio);
      }

      paint(shouldAnimate ? (performance.now() - startedAt) * 0.001 : 0);
    };

    const scheduleResize = () => {
      // react-doctor-disable-next-line react-hooks-js/todo -- Vite+ lint requires ??= here to avoid scheduling duplicate resize frames.
      resizeFrame ??= requestAnimationFrame(resize);
    };

    const render = (now: number) => {
      paint((now - startedAt) * 0.001);
      raf = requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (!shouldAnimate || raf !== 0 || !visible || cancelled) {
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

    const teardownGl = () => {
      stopLoop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      if (revealFrame !== null) {
        cancelAnimationFrame(revealFrame);
        revealFrame = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (gl && program) {
        gl.deleteProgram(program);
      }
      if (gl && vertexShader) {
        gl.deleteShader(vertexShader);
      }
      if (gl && fragmentShader) {
        gl.deleteShader(fragmentShader);
      }
      if (gl && positionBuffer) {
        gl.deleteBuffer(positionBuffer);
      }
      program = null;
      vertexShader = null;
      fragmentShader = null;
      positionBuffer = null;
      gl = null;
      lastDeviceWidth = 0;
      lastDeviceHeight = 0;
      cssWidth = 0;
      cssHeight = 0;
    };

    const initGl = () => {
      if (cancelled || gl) {
        return;
      }

      const context = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        desynchronized: true,
        powerPreference: "high-performance",
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        stencil: false,
      });
      if (!context) {
        return;
      }
      gl = context;

      vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      fragmentShader = compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        FRAGMENT_SHADER_SOURCE
      );
      if (vertexShader === null || fragmentShader === null) {
        teardownGl();
        return;
      }

      program = gl.createProgram();
      if (program === null) {
        teardownGl();
        return;
      }

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        teardownGl();
        return;
      }

      // react-doctor-disable-next-line react-hooks-js/hooks -- WebGL's useProgram method is not a React hook.
      gl.useProgram(program);

      positionBuffer = gl.createBuffer();
      if (positionBuffer === null) {
        teardownGl();
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW
      );

      const locations = getWorkspaceGlLocations(gl, program);
      if (!hasWorkspaceGlLocations(locations)) {
        teardownGl();
        return;
      }

      const {
        alphaScale: alphaScaleLocation,
        animate: animateLocation,
        color: colorLocation,
        cssSize: nextCssSizeLocation,
        dpr: nextDprLocation,
        falloff: falloffLocation,
        fieldDrift: nextFieldDriftLocation,
        focusA: nextFocusALocation,
        focusB: nextFocusBLocation,
        pattern: patternLocation,
        position: positionLocation,
        resolution: nextResolutionLocation,
        step: stepLocation,
        strengthWave: nextStrengthWaveLocation,
        time: nextTimeLocation,
      } = locations;
      cssSizeLocation = nextCssSizeLocation;
      dprLocation = nextDprLocation;
      resolutionLocation = nextResolutionLocation;
      timeLocation = nextTimeLocation;
      strengthWaveLocation = nextStrengthWaveLocation;
      focusALocation = nextFocusALocation;
      focusBLocation = nextFocusBLocation;
      fieldDriftLocation = nextFieldDriftLocation;

      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(stepLocation, gridStep);
      gl.uniform1f(falloffLocation, falloff);
      const patternIndex = {
        default: 0,
        "dual-foci": 3,
        "leading-corners": 2,
        "opposing-corners": 1,
      }[pattern];
      gl.uniform1f(patternLocation, patternIndex);

      const [red, green, blue] = activeDotRgb
        .split(",")
        .map((channel) => Number(channel.trim()) / 255);
      gl.uniform3f(colorLocation, red || 0, green || 0, blue || 0);
      gl.uniform1f(alphaScaleLocation, activeStrength);

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      shouldAnimate = animate && !prefersReducedMotion;
      gl.uniform1f(animateLocation, shouldAnimate ? 1 : 0);

      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(canvas);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      resize();
      startLoop();
    };

    if (animate) {
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
        { rootMargin: VISIBLE_ROOT_MARGIN }
      );
      intersection.observe(canvas);

      return () => {
        cancelled = true;
        intersection.disconnect();
        if (raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        teardownGl();
      };
    }
    visible = true;
    initGl();

    return () => {
      cancelled = true;
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      teardownGl();
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
