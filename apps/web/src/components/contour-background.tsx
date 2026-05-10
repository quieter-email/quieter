import alea from "alea";
import { useEffect, useMemo, useRef } from "react";

const SEED = 1337;

const DPR_LIMIT = 1.25;

const BLOB_COLUMNS = 11;
const BLOB_ROWS = 6;
const BLOB_MARGIN = 1;

const LINE_DENSITY = 18.0;
const LINE_WIDTH = 0.035;

const SOFT_UNION = 18.0;
const SPEED = 0.28;

const BACKGROUND_COLOR = [1, 1, 1] as const;
const LINE_COLOR = [0, 0, 0] as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type BlobConfig = {
  baseX: number;
  baseY: number;
  radius: number;
  driftX: number;
  driftY: number;
  phaseX: number;
  phaseY: number;
  speedX: number;
  speedY: number;
};

const createBlobConfigs = () => {
  const rng = alea(`sdf-contours:${SEED}`);
  const random = (min: number, max: number) => lerp(min, max, rng());

  const blobs: BlobConfig[] = [];

  for (let gy = -BLOB_MARGIN; gy < BLOB_ROWS + BLOB_MARGIN; gy++) {
    for (let gx = -BLOB_MARGIN; gx < BLOB_COLUMNS + BLOB_MARGIN; gx++) {
      blobs.push({
        baseX: (gx + 0.5 + random(-0.22, 0.22)) / BLOB_COLUMNS,
        baseY: (gy + 0.5 + random(-0.22, 0.22)) / BLOB_ROWS,
        radius: random(0.34, 0.54),
        driftX: random(0.035, 0.11),
        driftY: random(0.035, 0.11),
        phaseX: random(0, Math.PI * 2),
        phaseY: random(0, Math.PI * 2),
        speedX: random(0.06, 0.13),
        speedY: random(0.055, 0.12),
      });
    }
  }

  return blobs;
};

const createVertexShaderSource = () => `#version 300 es

in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const createFragmentShaderSource = (blobCount: number) => `#version 300 es

precision highp float;

#define BLOB_COUNT ${blobCount}
#define BLOB_COLUMNS ${BLOB_COLUMNS.toFixed(1)}
#define BLOB_ROWS ${BLOB_ROWS.toFixed(1)}

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;

uniform float u_lineDensity;
uniform float u_lineWidth;
uniform float u_softUnion;

uniform vec3 u_backgroundColor;
uniform vec3 u_lineColor;

uniform vec4 u_blobA[BLOB_COUNT];
uniform vec4 u_blobB[BLOB_COUNT];
uniform vec4 u_blobC[BLOB_COUNT];

float softUnionDistance(vec2 uv) {
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = vec2(uv.x * aspect, uv.y);

  float cellWidth = aspect / BLOB_COLUMNS;
  float cellHeight = 1.0 / BLOB_ROWS;
  float cellSize = max(cellWidth, cellHeight);

  float sumValue = 0.0;

  for (int i = 0; i < BLOB_COUNT; i++) {
    vec4 a = u_blobA[i];
    vec4 b = u_blobB[i];
    vec4 c = u_blobC[i];

    float x =
      a.x +
      sin(u_time * c.x + b.z) * b.x / BLOB_COLUMNS +
      sin(u_time * c.x * 0.43 + b.w) * b.x * 0.35 / BLOB_COLUMNS;

    float y =
      a.y +
      cos(u_time * c.y + b.w) * b.y / BLOB_ROWS +
      cos(u_time * c.y * 0.47 + b.z) * b.y * 0.35 / BLOB_ROWS;

    vec2 center = vec2(x * aspect, y);

    float radius = a.z * cellSize;
    float distanceToCircle = length(p - center) - radius;

    sumValue += exp(-u_softUnion * distanceToCircle);
  }

  return -log(sumValue) / u_softUnion;
}

void main() {
  float distanceField = softUnionDistance(v_uv);

  float contourValue = distanceField * u_lineDensity;

  float nearestLine = abs(fract(contourValue + 0.5) - 0.5);

  float aa = fwidth(contourValue) * 1.25;
  float line = 1.0 - smoothstep(u_lineWidth, u_lineWidth + aa, nearestLine);

  vec3 color = mix(u_backgroundColor, u_lineColor, line);

  outColor = vec4(color, 1.0);
}
`;

const createShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();

  if (!program) {
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
};

export const ContourBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const blobs = useMemo(() => createBlobConfigs(), []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      return;
    }

    const program = createProgram(
      gl,
      createVertexShaderSource(),
      createFragmentShaderSource(blobs.length),
    );

    if (!program) {
      return;
    }

    const positionBuffer = gl.createBuffer();

    if (!positionBuffer) {
      gl.deleteProgram(program);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "a_position");

    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const lineDensityLocation = gl.getUniformLocation(program, "u_lineDensity");
    const lineWidthLocation = gl.getUniformLocation(program, "u_lineWidth");
    const softUnionLocation = gl.getUniformLocation(program, "u_softUnion");

    const backgroundColorLocation = gl.getUniformLocation(program, "u_backgroundColor");
    const lineColorLocation = gl.getUniformLocation(program, "u_lineColor");

    const blobALocation = gl.getUniformLocation(program, "u_blobA[0]");
    const blobBLocation = gl.getUniformLocation(program, "u_blobB[0]");
    const blobCLocation = gl.getUniformLocation(program, "u_blobC[0]");

    const blobA = new Float32Array(blobs.length * 4);
    const blobB = new Float32Array(blobs.length * 4);
    const blobC = new Float32Array(blobs.length * 4);

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const index = i * 4;

      blobA[index] = blob.baseX;
      blobA[index + 1] = blob.baseY;
      blobA[index + 2] = blob.radius;
      blobA[index + 3] = 0;

      blobB[index] = blob.driftX;
      blobB[index + 1] = blob.driftY;
      blobB[index + 2] = blob.phaseX;
      blobB[index + 3] = blob.phaseY;

      blobC[index] = blob.speedX * SPEED;
      blobC[index + 1] = blob.speedY * SPEED;
      blobC[index + 2] = 0;
      blobC[index + 3] = 0;
    }

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    let raf = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const render = (timeMs: number) => {
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform1f(timeLocation, timeMs * 0.001);

      gl.uniform1f(lineDensityLocation, LINE_DENSITY);
      gl.uniform1f(lineWidthLocation, LINE_WIDTH);
      gl.uniform1f(softUnionLocation, SOFT_UNION);

      gl.uniform3f(
        backgroundColorLocation,
        BACKGROUND_COLOR[0],
        BACKGROUND_COLOR[1],
        BACKGROUND_COLOR[2],
      );

      gl.uniform3f(lineColorLocation, LINE_COLOR[0], LINE_COLOR[1], LINE_COLOR[2]);

      gl.uniform4fv(blobALocation, blobA);
      gl.uniform4fv(blobBLocation, blobB);
      gl.uniform4fv(blobCLocation, blobC);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      raf = requestAnimationFrame(render);
    };

    resize();
    raf = requestAnimationFrame(render);

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);

      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [blobs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
        background: "#ffffff",
      }}
    />
  );
};
