"use client";

import { useEffect, useRef } from "react";

const maximumPulseCount = 6;

type Pulse = {
  startedAt: number;
  x: number;
  y: number;
};

type Rgb = [number, number, number];

const vertexShaderSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

#define MAX_PULSES 6
#define FIELD_SEARCH_RADIUS 6
#define REST_SEARCH_RADIUS 3

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform vec3 uColor;
uniform vec3 uBackgroundColor;
uniform vec2 uCursor;
uniform float uHasCursor;
uniform float uTime;
uniform int uPulseCount;
uniform vec3 uPulses[MAX_PULSES];

float hash(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

float cursorFalloffRadius(float unit) {
  return clamp(unit * 8.4, 640.0, 1120.0);
}

float cursorPush(float unit) {
  return clamp(unit * 0.13, 9.0, 15.0);
}

bool shouldSkipCell(vec2 point, int x, int y) {
  int searchRadius = REST_SEARCH_RADIUS;

  if (uHasCursor > 0.5) {
    float unit = min(uResolution.x, uResolution.y) / 10.0;
    float distanceValue = length(point - uCursor);
    float activeRadius = cursorFalloffRadius(unit);

    if (distanceValue < activeRadius) {
      searchRadius = FIELD_SEARCH_RADIUS;
    }
  }

  return abs(x) > searchRadius || abs(y) > searchRadius;
}

float squircleRadius(vec2 point, float scale) {
  vec2 center = uResolution * 0.5;
  vec2 offset = point - center;
  float rotationCos = 0.70710678118;
  float rotationSin = 0.70710678118;
  vec2 local = vec2(
    offset.x * rotationCos + offset.y * rotationSin,
    -offset.x * rotationSin + offset.y * rotationCos
  ) / scale;
  float unit = min(uResolution.x, uResolution.y) / 10.0;
  float radius = pow(2.0, 0.25) * unit * 2.0;
  float distanceValue = pow(abs(local.x) / radius, 4.0) + pow(abs(local.y) / radius, 4.0);

  return pow(distanceValue, 0.25);
}

vec2 displacementFor(vec2 point) {
  float unit = min(uResolution.x, uResolution.y) / 10.0;
  vec2 displacement = vec2(0.0);

  if (uHasCursor > 0.5) {
    vec2 offset = point - uCursor;
    float distanceValue = length(offset);
    float falloffRadius = cursorFalloffRadius(unit);

    if (distanceValue < falloffRadius) {
      float angle = hash(point) * 6.28318530718;
      vec2 direction = distanceValue > 0.001 ? offset / distanceValue : vec2(cos(angle), sin(angle));
      float falloffProgress = distanceValue / falloffRadius;
      float force = 1.0 - falloffProgress;

      displacement += direction * force * cursorPush(unit);
    }
  }

  float pulseWidth = unit * 0.82;
  float pulseMaxRadius = min(length(uResolution) * 0.62, unit * 9.0) + pulseWidth;
  float pulseDuration = 1450.0;

  for (int index = 0; index < MAX_PULSES; index += 1) {
    if (index >= uPulseCount) break;

    vec3 pulse = uPulses[index];
    float progress = (uTime - pulse.z) / pulseDuration;

    if (progress < 0.0 || progress > 1.0) continue;

    vec2 offset = point - pulse.xy;
    float distanceValue = length(offset);
    float waveRadius = mix(pulseWidth * 1.7, pulseMaxRadius, progress);
    float distanceToWave = abs(distanceValue - waveRadius);

    if (distanceToWave > pulseWidth) continue;

    float wavePosition = (distanceValue - waveRadius) / pulseWidth;
    float waveShape = -sin(wavePosition * 3.14159265359);
    float waveFade = 1.0 - progress;
    float wave = waveShape * waveFade;
    vec2 direction = distanceValue > 0.001
      ? offset / distanceValue
      : vec2(cos(hash(point + pulse.xy) * 6.28318530718), sin(hash(point + pulse.xy) * 6.28318530718));

    displacement += direction * wave * unit * 0.07;
  }

  return displacement;
}

float dotMask(vec2 point, vec2 center, float radius) {
  float distanceValue = length(point - center);
  float antialias = 0.65;

  return 1.0 - smoothstep(max(radius - antialias, 0.0), radius + antialias, distanceValue);
}

float addAlpha(float baseAlpha, float nextAlpha) {
  return baseAlpha + nextAlpha * (1.0 - baseAlpha);
}

float noiseAlpha(vec2 point) {
  float dotGap = 4.0;
  vec2 baseCell = floor(point / dotGap);
  float alpha = 0.0;

  for (int y = -FIELD_SEARCH_RADIUS; y <= FIELD_SEARCH_RADIUS; y += 1) {
    for (int x = -FIELD_SEARCH_RADIUS; x <= FIELD_SEARCH_RADIUS; x += 1) {
      if (shouldSkipCell(point, x, y)) continue;

      vec2 cell = baseCell + vec2(float(x), float(y));
      vec2 jitter = vec2(hash(cell + 53.0), hash(cell + 193.0)) - 0.5;
      vec2 center = (cell + 0.5) * dotGap + jitter * dotGap;
      float outerRadius = squircleRadius(center, 1.0);
      float nearestRadius = min(
        min(squircleRadius(center, 1.0), squircleRadius(center, 0.9)),
        min(squircleRadius(center, 0.8), squircleRadius(center, 0.7))
      );
      float insideOuter = 1.0 - smoothstep(0.94, 1.08, outerRadius);
      float edgeScatter = 1.0 - smoothstep(0.0, 0.7, abs(nearestRadius - 1.0));
      float innerScatter =
        (1.0 - step(1.0, nearestRadius)) *
        (1.0 - smoothstep(0.0, 0.85, 1.0 - nearestRadius));
      float outerScatter =
        step(1.0, nearestRadius) *
        (1.0 - smoothstep(0.0, 0.95, nearestRadius - 1.0));
      float logoScatter = max(edgeScatter, max(innerScatter, outerScatter));
      float density = clamp(
        0.44 + logoScatter * 0.38,
        0.0,
        0.97
      );
      float shouldDraw = step(hash(cell + 719.0), density);
      float radius = mix(0.25 + hash(cell + 389.0) * 0.65, 0.45 + hash(cell + 389.0) * 1.35, logoScatter);
      vec2 displacedCenter = center + displacementFor(center);
      float dotAlpha = dotMask(point, displacedCenter, radius) * shouldDraw;
      float opacity = mix(1.0, 0.2, insideOuter);

      alpha = addAlpha(alpha, dotAlpha * opacity);
    }
  }

  return alpha;
}

float layerScale(int index) {
  if (index == 0) return 1.0;
  if (index == 1) return 0.9;
  if (index == 2) return 0.8;
  return 0.7;
}

float layerOpacity(int index) {
  if (index == 0) return 1.0;
  if (index == 1) return 0.8;
  if (index == 2) return 0.6;
  return 0.4;
}

float ringAlpha(vec2 point) {
  float unit = min(uResolution.x, uResolution.y) / 10.0;
  float dotGap = 4.0;
  float radius = pow(2.0, 0.25) * unit * 2.0;
  float halfRingWidth = (unit * 0.22 * 2.0) / radius / 2.0;
  vec2 baseCell = floor(point / dotGap);
  float alpha = 0.0;

  for (int layerIndex = 0; layerIndex < 4; layerIndex += 1) {
    float scale = layerScale(layerIndex);
    float opacity = layerOpacity(layerIndex);

    for (int y = -FIELD_SEARCH_RADIUS; y <= FIELD_SEARCH_RADIUS; y += 1) {
      for (int x = -FIELD_SEARCH_RADIUS; x <= FIELD_SEARCH_RADIUS; x += 1) {
        if (shouldSkipCell(point, x, y)) continue;

        vec2 cell = baseCell + vec2(float(x), float(y));
        vec2 seed = cell + vec2(float(layerIndex) * 101.0, float(layerIndex) * 211.0);
        vec2 jitter = vec2(hash(seed), hash(seed.yx)) - 0.5;
        vec2 center = (cell + 0.5) * dotGap + jitter * 1.5;
        float radiusValue = squircleRadius(center, scale);
        float distanceFromCenterLine = abs(radiusValue - 1.0);
        float isInsideBand = 1.0 - step(halfRingWidth, distanceFromCenterLine);
        float distanceFromRingEdge = halfRingWidth - distanceFromCenterLine;
        float edgeAmount = clamp(1.0 - distanceFromRingEdge / halfRingWidth, 0.0, 1.0);
        float edgeStrength = pow(edgeAmount, 0.35);
        float density = edgeAmount > 0.62 ? 1.0 : 0.12 + edgeStrength * 0.58;
        float shouldDraw = step(hash(seed + 29.0), density) * isInsideBand;
        float dotRadius = (0.35 + edgeStrength * 1.55) * scale;
        vec2 displacedCenter = center + displacementFor(center);
        float dotAlpha =
          dotMask(point, displacedCenter, dotRadius) * shouldDraw * opacity * (0.12 + edgeStrength * 0.88);

        alpha = addAlpha(alpha, dotAlpha);
      }
    }
  }

  return alpha;
}

void main() {
  vec2 point = vec2(vUv.x * uResolution.x, (1.0 - vUv.y) * uResolution.y);
  float alpha = addAlpha(noiseAlpha(point), ringAlpha(point));

  outColor = vec4(mix(uBackgroundColor, uColor, alpha), 1.0);
}
`;

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

const createShader = (
  gl: WebGL2RenderingContext,
  type: WebGL2RenderingContext["VERTEX_SHADER"] | WebGL2RenderingContext["FRAGMENT_SHADER"],
  source: string,
) => {
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
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const pulsesRef = useRef<Pulse[]>([]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    if (!gl) return;

    const program = createProgram(gl);
    if (!program) return;

    const positionAttribute = gl.getAttribLocation(program, "aPosition");
    const resolutionUniform = gl.getUniformLocation(program, "uResolution");
    const colorUniform = gl.getUniformLocation(program, "uColor");
    const backgroundColorUniform = gl.getUniformLocation(program, "uBackgroundColor");
    const cursorUniform = gl.getUniformLocation(program, "uCursor");
    const hasCursorUniform = gl.getUniformLocation(program, "uHasCursor");
    const timeUniform = gl.getUniformLocation(program, "uTime");
    const pulseCountUniform = gl.getUniformLocation(program, "uPulseCount");
    const pulsesUniform = gl.getUniformLocation(program, "uPulses[0]");

    if (
      positionAttribute < 0 ||
      !resolutionUniform ||
      !colorUniform ||
      !backgroundColorUniform ||
      !cursorUniform ||
      !hasCursorUniform ||
      !timeUniform ||
      !pulseCountUniform ||
      !pulsesUniform
    )
      return;

    const buffer = gl.createBuffer();
    if (!buffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionAttribute);
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 1);

    let animationFrame = 0;
    let width = 0;
    let height = 0;
    const pulseData = new Float32Array(maximumPulseCount * 3);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(globalThis.window.devicePixelRatio || 1, 1.5);
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      const pixelWidth = Math.max(1, Math.round(nextWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(nextHeight * dpr));

      width = nextWidth;
      height = nextHeight;

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        gl.viewport(0, 0, pixelWidth, pixelHeight);
      }
    };

    const render = () => {
      resize();

      const now = globalThis.performance.now();
      pulsesRef.current = pulsesRef.current.filter((pulse) => now - pulse.startedAt <= 1450);
      pulseData.fill(0);

      for (const [index, pulse] of pulsesRef.current.slice(0, maximumPulseCount).entries()) {
        pulseData[index * 3] = pulse.x;
        pulseData[index * 3 + 1] = pulse.y;
        pulseData[index * 3 + 2] = pulse.startedAt;
      }

      const cursor = cursorRef.current;
      const color = getCssColor(canvas, "--primary", [0.25, 0.25, 0.25]);
      const background = getCssColor(
        canvas,
        "background-color",
        getCssColor(canvas, "--background", [0.02, 0.02, 0.02]),
      );

      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(resolutionUniform, width, height);
      gl.uniform3f(colorUniform, color[0], color[1], color[2]);
      gl.uniform3f(backgroundColorUniform, background[0], background[1], background[2]);
      gl.uniform2f(cursorUniform, cursor?.x ?? 0, cursor?.y ?? 0);
      gl.uniform1f(hasCursorUniform, cursor ? 1 : 0);
      gl.uniform1f(timeUniform, now);
      gl.uniform1i(pulseCountUniform, Math.min(pulsesRef.current.length, maximumPulseCount));
      gl.uniform3fv(pulsesUniform, pulseData);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const animate = () => {
      render();

      if (pulsesRef.current.length > 0) {
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
      const rect = canvas.getBoundingClientRect();
      cursorRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      queueRender();
    };
    const handlePointerRawUpdate = (event: Event) => {
      if (event instanceof PointerEvent) handlePointerMove(event);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      cursorRef.current = point;
      pulsesRef.current.push({
        ...point,
        startedAt: globalThis.performance.now(),
      });

      if (pulsesRef.current.length > maximumPulseCount) {
        pulsesRef.current = pulsesRef.current.slice(-maximumPulseCount);
      }

      queueRender();
    };

    render();

    const resizeObserver = new ResizeObserver(() => queueRender());
    resizeObserver.observe(canvas);
    globalThis.window.addEventListener("pointermove", handlePointerMove);
    globalThis.window.addEventListener("pointerrawupdate", handlePointerRawUpdate);
    globalThis.window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      globalThis.window.removeEventListener("pointermove", handlePointerMove);
      globalThis.window.removeEventListener("pointerrawupdate", handlePointerRawUpdate);
      globalThis.window.removeEventListener("pointerdown", handlePointerDown);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas aria-hidden className="size-full bg-background" ref={canvasRef} />;
};
