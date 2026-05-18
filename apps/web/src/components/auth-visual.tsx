"use client";

import { useEffect, useRef } from "react";

const cursorTrailDuration = 1160;
const cursorTrailMinDistance = 3;
const cursorTrailSampleLimit = 44;
const dotGap = 4;
const maxDevicePixelRatio = 2;
const dotStrideBytes = 4 * Float32Array.BYTES_PER_ELEMENT;

type Point = {
  x: number;
  y: number;
};

type TrailSample = Point & {
  speed: number;
  startedAt: number;
};

type Rgb = [number, number, number];

type Dot = {
  opacity: number;
  radius: number;
  x: number;
  y: number;
};

const vertexShaderSource = `#version 300 es
#define MAX_TRAIL_SAMPLES 44

in vec2 aCenter;
in float aRadius;
in float aOpacity;

out float vOpacity;
out float vPointSize;
out float vRadius;

uniform vec2 uResolution;
uniform vec2 uCursor;
uniform float uHasCursor;
uniform float uCursorSpeed;
uniform float uTime;
uniform int uTrailSampleCount;
uniform vec4 uTrailSamples[MAX_TRAIL_SAMPLES];

vec2 trailDisplacementFor(vec2 point) {
  float unit = min(uResolution.x, uResolution.y) / 10.0;
  float falloffRadius = clamp(unit * 0.26, 28.0, 58.0);
  float pushDistance = clamp(unit * 0.2, 16.0, 34.0);
  float force = 0.0;
  vec2 directionSum = vec2(0.0);

  if (uHasCursor > 0.5) {
    vec2 cursorOffset = point - uCursor;
    float cursorDistance = length(cursorOffset);
    float cursorFalloffRadius = falloffRadius * mix(1.55, 0.46, uCursorSpeed);
    float normalizedCursorDistance = cursorDistance / cursorFalloffRadius;
    float cursorForce = exp(-normalizedCursorDistance * normalizedCursorDistance * 0.82);
    vec2 cursorDirection = cursorDistance > 0.001 ? cursorOffset / cursorDistance : vec2(1.0, 0.0);

    force = cursorForce;
    directionSum = cursorDirection * cursorForce * cursorForce * cursorForce;
  }

  for (int index = 0; index < MAX_TRAIL_SAMPLES - 1; index += 1) {
    if (index >= uTrailSampleCount - 1) break;

    vec4 startSample = uTrailSamples[index];
    vec4 endSample = uTrailSamples[index + 1];
    vec2 segment = endSample.xy - startSample.xy;
    float segmentLengthSquared = dot(segment, segment);
    float segmentProgress = segmentLengthSquared > 0.001
      ? clamp(dot(point - startSample.xy, segment) / segmentLengthSquared, 0.0, 1.0)
      : 0.0;
    vec2 closestPoint = mix(startSample.xy, endSample.xy, segmentProgress);
    float sampleTime = mix(startSample.z, endSample.z, segmentProgress);
    float sampleSpeed = mix(startSample.w, endSample.w, segmentProgress);
    float age = uTime - sampleTime;
    float sampleDuration = mix(620.0, 1160.0, sampleSpeed);

    if (age < 0.0 || age > sampleDuration) continue;

    vec2 offset = point - closestPoint;
    float distanceValue = length(offset);

    float sampleFalloffRadius = falloffRadius * mix(1.45, 0.38, sampleSpeed);
    float ageStrength = 1.0 - smoothstep(0.0, sampleDuration, age);
    float newestStrength = smoothstep(0.0, 1.0, (float(index) + segmentProgress) / max(float(uTrailSampleCount - 1), 1.0));
    vec2 fallbackDirection = normalize(vec2(-segment.y, segment.x) + vec2(0.001, 0.0));
    vec2 direction = distanceValue > 0.001 ? offset / distanceValue : fallbackDirection;
    float normalizedDistance = distanceValue / sampleFalloffRadius;
    float gravity = exp(-normalizedDistance * normalizedDistance * 0.82);
    float sampleForce = gravity * ageStrength * mix(0.35, 1.0, newestStrength);
    float directionWeight = sampleForce * sampleForce * sampleForce;

    force = max(force, sampleForce);
    directionSum += direction * directionWeight;
  }

  float directionLength = length(directionSum);

  if (force <= 0.0001 || directionLength <= 0.0001) {
    return vec2(0.0);
  }

  return directionSum / directionLength * force * pushDistance;
}

void main() {
  vec2 center = aCenter + trailDisplacementFor(aCenter);

  vOpacity = aOpacity;
  vRadius = aRadius;
  vPointSize = (aRadius + 0.65) * 2.0;

  gl_PointSize = vPointSize;
  gl_Position = vec4(center.x / uResolution.x * 2.0 - 1.0, 1.0 - center.y / uResolution.y * 2.0, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

in float vOpacity;
in float vPointSize;
in float vRadius;

out vec4 outColor;

uniform vec3 uColor;

void main() {
  float distanceValue = length((gl_PointCoord - 0.5) * vPointSize);
  float alpha = 1.0 - smoothstep(max(vRadius - 0.65, 0.0), vRadius + 0.65, distanceValue);

  outColor = vec4(uColor, alpha * vOpacity);
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

const distanceBetween = (first: Point, second: Point) =>
  Math.hypot(first.x - second.x, first.y - second.y);

const speedForDistance = (distance: number, elapsedMs: number) =>
  clamp(distance / Math.max(elapsedMs, 16) / 2.1, 0, 1);

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
  width: number,
  height: number,
) => {
  const jitterX = hash(cellX + 53, cellY + 53) - 0.5;
  const jitterY = hash(cellX + 193, cellY + 193) - 0.5;
  const center = {
    x: (cellX + 0.5) * dotGap + jitterX * dotGap,
    y: (cellY + 0.5) * dotGap + jitterY * dotGap,
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
    radius: mix(0.25 + radiusSeed * 0.65, 0.45 + radiusSeed * 1.35, logoScatter),
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
  const center = {
    x: (cellX + 0.5) * dotGap + jitterX * 1.5,
    y: (cellY + 0.5) * dotGap + jitterY * 1.5,
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
    radius: (0.35 + edgeStrength * 1.55) * scale,
  });
};

const buildDots = (width: number, height: number) => {
  const unit = Math.min(width, height) / 10;
  const margin = Math.ceil((Math.max(15, unit * 0.13 + 2) + dotGap) / dotGap);
  const minCellX = -margin;
  const maxCellX = Math.ceil(width / dotGap) + margin;
  const minCellY = -margin;
  const maxCellY = Math.ceil(height / dotGap) + margin;
  const dots: Dot[] = [];

  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      appendNoiseDot(dots, cellX, cellY, width, height);

      for (let layerIndex = 0; layerIndex < 4; layerIndex += 1) {
        appendRingDot(dots, cellX, cellY, layerIndex, width, height);
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
    const resolutionUniform = gl.getUniformLocation(program, "uResolution");
    const colorUniform = gl.getUniformLocation(program, "uColor");
    const cursorUniform = gl.getUniformLocation(program, "uCursor");
    const hasCursorUniform = gl.getUniformLocation(program, "uHasCursor");
    const cursorSpeedUniform = gl.getUniformLocation(program, "uCursorSpeed");
    const timeUniform = gl.getUniformLocation(program, "uTime");
    const trailSampleCountUniform = gl.getUniformLocation(program, "uTrailSampleCount");
    const trailSamplesUniform = gl.getUniformLocation(program, "uTrailSamples[0]");

    if (
      centerAttribute < 0 ||
      radiusAttribute < 0 ||
      opacityAttribute < 0 ||
      !resolutionUniform ||
      !colorUniform ||
      !cursorUniform ||
      !hasCursorUniform ||
      !cursorSpeedUniform ||
      !timeUniform ||
      !trailSampleCountUniform ||
      !trailSamplesUniform
    )
      return;

    const dotBuffer = gl.createBuffer();
    if (!dotBuffer) return;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.enableVertexAttribArray(centerAttribute);
    gl.enableVertexAttribArray(radiusAttribute);
    gl.enableVertexAttribArray(opacityAttribute);
    gl.vertexAttribPointer(centerAttribute, 2, gl.FLOAT, false, dotStrideBytes, 0);
    gl.vertexAttribPointer(
      radiusAttribute,
      1,
      gl.FLOAT,
      false,
      dotStrideBytes,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribPointer(
      opacityAttribute,
      1,
      gl.FLOAT,
      false,
      dotStrideBytes,
      3 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(centerAttribute, 1);
    gl.vertexAttribDivisor(radiusAttribute, 1);
    gl.vertexAttribDivisor(opacityAttribute, 1);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let animationFrame = 0;
    let bufferWidth = 0;
    let bufferHeight = 0;
    let cssWidth = 1;
    let cssHeight = 1;
    let dotCount = 0;
    let canvasRect = canvas.getBoundingClientRect();
    let cursorTrail: TrailSample[] = [];
    let cursor: Point | null = null;
    let trailHead: TrailSample | null = null;
    let trailTarget: Point | null = null;
    let lastClientPoint: Point | null = null;
    let lastRenderTime = 0;
    let wasPointerInside = false;
    const canAnimateCursorTrail =
      globalThis.window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cursorTrailData = new Float32Array(cursorTrailSampleLimit * 4);
    let colors = {
      background: getCssColor(
        canvas,
        "background-color",
        getCssColor(canvas, "--background", [0.02, 0.02, 0.02]),
      ),
      primary: getCssColor(canvas, "--primary", [0.25, 0.25, 0.25]),
    };

    const refreshColors = () => {
      colors = {
        background: getCssColor(
          canvas,
          "background-color",
          getCssColor(canvas, "--background", [0.02, 0.02, 0.02]),
        ),
        primary: getCssColor(canvas, "--primary", [0.25, 0.25, 0.25]),
      };
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

    const pushCursorTrailPoint = (sample: TrailSample) => {
      const lastPoint = cursorTrail.at(-1);

      if (lastPoint && distanceBetween(lastPoint, sample) < cursorTrailMinDistance) {
        lastPoint.speed = sample.speed;
        lastPoint.startedAt = sample.startedAt;
        return;
      }

      cursorTrail = [...cursorTrail, sample].slice(-cursorTrailSampleLimit);
    };

    const syncTrailHead = (now: number) => {
      if (!trailTarget) return false;

      if (!trailHead) {
        trailHead = { ...trailTarget, speed: 0, startedAt: now };
        pushCursorTrailPoint(trailHead);
        return false;
      }

      const elapsedMs = clamp(now - lastRenderTime, 8, 48);
      const catchup = 1 - Math.exp((-elapsedMs / 1000) * 18);
      const nextPoint = {
        x: mix(trailHead.x, trailTarget.x, catchup),
        y: mix(trailHead.y, trailTarget.y, catchup),
      };
      const movedDistance = distanceBetween(trailHead, nextPoint);
      const remainingDistance = distanceBetween(nextPoint, trailTarget);

      trailHead = {
        ...nextPoint,
        speed: mix(trailHead.speed, speedForDistance(movedDistance, elapsedMs), 0.45),
        startedAt: now,
      };

      if (movedDistance >= 0.2) pushCursorTrailPoint(trailHead);

      return remainingDistance > 0.35 || movedDistance > 0.05;
    };

    const syncDots = () => {
      const dots = buildDots(bufferWidth, bufferHeight);
      const data = new Float32Array(dots.length * 4);

      for (const [index, dot] of dots.entries()) {
        data[index * 4] = dot.x;
        data[index * 4 + 1] = dot.y;
        data[index * 4 + 2] = dot.radius;
        data[index * 4 + 3] = dot.opacity;
      }

      dotCount = dots.length;
      gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    };

    const resize = () => {
      canvasRect = canvas.getBoundingClientRect();
      const dpr = Math.min(globalThis.window.devicePixelRatio || 1, maxDevicePixelRatio);
      const nextCssWidth = Math.max(1, canvasRect.width);
      const nextCssHeight = Math.max(1, canvasRect.height);
      const pixelWidth = Math.max(1, Math.round(nextCssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(nextCssHeight * dpr));

      cssWidth = nextCssWidth;
      cssHeight = nextCssHeight;

      if (bufferWidth === pixelWidth && bufferHeight === pixelHeight) return;

      bufferWidth = pixelWidth;
      bufferHeight = pixelHeight;
      cursorTrail = [];
      trailHead = null;
      trailTarget = null;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      syncDots();
    };

    const render = () => {
      const now = globalThis.performance.now();
      const color = colors.primary;
      const background = colors.background;
      const isTrailHeadMoving = syncTrailHead(now);

      cursorTrail = cursorTrail.filter((point) => now - point.startedAt <= cursorTrailDuration);
      cursorTrailData.fill(0);

      if (!wasPointerInside && !isTrailHeadMoving) {
        trailHead = null;
        trailTarget = null;
      }

      for (const [index, point] of cursorTrail.entries()) {
        cursorTrailData[index * 4] = point.x;
        cursorTrailData[index * 4 + 1] = point.y;
        cursorTrailData[index * 4 + 2] = point.startedAt;
        cursorTrailData[index * 4 + 3] = point.speed;
      }

      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(resolutionUniform, bufferWidth, bufferHeight);
      gl.uniform3f(colorUniform, color[0], color[1], color[2]);
      gl.uniform2f(cursorUniform, trailHead?.x ?? 0, trailHead?.y ?? 0);
      gl.uniform1f(hasCursorUniform, wasPointerInside && trailHead ? 1 : 0);
      gl.uniform1f(cursorSpeedUniform, wasPointerInside && trailHead ? trailHead.speed : 0);
      gl.uniform1f(timeUniform, now);
      gl.uniform1i(trailSampleCountUniform, Math.min(cursorTrail.length, cursorTrailSampleLimit));
      gl.uniform4fv(trailSamplesUniform, cursorTrailData);
      gl.drawArraysInstanced(gl.POINTS, 0, 1, dotCount);

      lastRenderTime = now;

      return cursorTrail.length > 0 || isTrailHeadMoving;
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
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;

      let shouldRender = false;
      const pointerEvents = event.getCoalescedEvents();

      for (const pointerEvent of pointerEvents.length ? pointerEvents : [event]) {
        const clientPoint = {
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
        };
        const canvasPoint = toCanvasPoint(clientPoint, true);

        if (canvasPoint) {
          const now = globalThis.performance.now();

          cursor = canvasPoint;
          trailTarget = canvasPoint;
          shouldRender = true;

          if (!wasPointerInside && lastClientPoint) {
            const entryPoint = toCanvasPoint(lastClientPoint, false) ?? canvasPoint;

            trailHead = {
              ...entryPoint,
              speed: 0,
              startedAt: now,
            };
            pushCursorTrailPoint(trailHead);
          }

          wasPointerInside = true;
        } else {
          if (cursor) shouldRender = true;

          cursor = null;
          trailTarget = toCanvasPoint(clientPoint, false);
          wasPointerInside = false;
        }

        lastClientPoint = clientPoint;
      }

      if (shouldRender) queueRender();
    };

    const handlePointerRawUpdate = (event: Event) => {
      if (event instanceof PointerEvent) handlePointerMove(event);
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
    if (canAnimateCursorTrail) {
      globalThis.window.addEventListener("pointermove", handlePointerMove, { passive: true });
      canvas.addEventListener("pointerrawupdate", handlePointerRawUpdate, { passive: true });
    }

    return () => {
      if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (canAnimateCursorTrail) {
        globalThis.window.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerrawupdate", handlePointerRawUpdate);
      }
      gl.deleteBuffer(dotBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas aria-hidden className="block size-full bg-background" ref={canvasRef} />;
};
