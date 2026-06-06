"use client";

import { useEffect, useRef } from "react";

const DITHER_STEP = 3;
const MAX_PIXEL_RATIO = 2;

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

  float horizontal = column / columns;
  float vertical = row / rows;
  float bottomLeftToTopRight = clamp((1.0 - horizontal + vertical) * 0.5, 0.0, 1.0);
  float contour =
    sin(horizontal * 13.5 + vertical * 6.5) * 0.09 +
    sin(horizontal * 5.5 - vertical * 15.0) * 0.055;
  float density = clamp(pow(bottomLeftToTopRight, 1.28) + contour, 0.0, 1.0);
  float threshold = density * 1.03 - 0.06;

  if (hashAt(vec2(column, row)) > threshold) {
    discard;
  }

  float jitter = hashAt(vec2(column + 53.0, row + 97.0));
  float radius = 0.12 + pow(density, 1.35) * (0.42 + jitter * 0.1);
  float alpha = 0.08 + pow(density, 1.18) * 0.32;

  vec2 center = vec2(column * uStep, row * uStep);
  float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, distance(cssPixel, center));
  float finalAlpha = alpha * coverage;

  gl_FragColor = vec4(uColor * finalAlpha, finalAlpha);
}
`;

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

export const WorkspaceDitherBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      stencil: false,
    });
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    const activateProgram = gl.useProgram.bind(gl);
    activateProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, "uResolution");
    const cssSizeLocation = gl.getUniformLocation(program, "uCssSize");
    const stepLocation = gl.getUniformLocation(program, "uStep");
    const dprLocation = gl.getUniformLocation(program, "uDpr");
    const colorLocation = gl.getUniformLocation(program, "uColor");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(stepLocation, DITHER_STEP);

    const applyColor = () => {
      const raw = getComputedStyle(canvas).getPropertyValue("--workspace-dither-dot-rgb").trim();
      const [red, green, blue] = (raw || "255, 255, 255")
        .split(",")
        .map((channel) => Number.parseFloat(channel) / 255);
      gl.uniform3f(colorLocation, red || 0, green || 0, blue || 0);
    };

    const draw = () => {
      const { height, width } = canvas.getBoundingClientRect();
      if (!height || !width) return;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const deviceWidth = Math.ceil(width * pixelRatio);
      const deviceHeight = Math.ceil(height * pixelRatio);

      if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
        canvas.width = deviceWidth;
        canvas.height = deviceHeight;
      }

      gl.viewport(0, 0, deviceWidth, deviceHeight);
      gl.uniform2f(resolutionLocation, deviceWidth, deviceHeight);
      gl.uniform2f(cssSizeLocation, width, height);
      gl.uniform1f(dprLocation, pixelRatio);
      applyColor();

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    draw();

    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
    };
  }, []);

  return (
    <canvas
      className="pointer-events-none absolute inset-0 z-0 size-full overflow-hidden"
      ref={canvasRef}
    />
  );
};
