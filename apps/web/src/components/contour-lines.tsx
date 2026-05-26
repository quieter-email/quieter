import { useEffect, useRef } from "react";

const FRAME_INTERVAL_MS = 1000 / 30;

const VERTEX_SHADER_SOURCE = `
  attribute vec2 aPosition;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;

  /* ── simplex 3D noise ─────────────────────────── */

  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 c = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 d = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, c.yyy));
    vec3 x0 = v - i + dot(i, c.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + c.xxx;
    vec3 x2 = x0 - i2 + c.yyy;
    vec3 x3 = x0 - d.yyy;

    i = mod289(i);
    vec4 p = permute(
      permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
        i.x + vec4(0.0, i1.x, i2.x, 1.0)
    );

    float n = 0.142857142857;
    vec3 ns = n * d.wyz - d.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 xn = x_ * ns.x + ns.yyyy;
    vec4 yn = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(xn) - abs(yn);
    vec4 b0 = vec4(xn.xy, yn.xy);
    vec4 b1 = vec4(xn.zw, yn.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));

    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m *= m;

    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  /* ── per-cell hash ─────────────────────────────── */

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  /* ── HSV → RGB (full control) ────────────────── */

  vec3 hsv2rgb(float h, float s, float v) {
    float hh = fract(h) * 6.0;
    float f = fract(hh);
    float p = v * (1.0 - s);
    float q = v * (1.0 - s * f);
    float t = v * (1.0 - s * (1.0 - f));

    if (hh < 1.0) return vec3(v, t, p);
    if (hh < 2.0) return vec3(q, v, p);
    if (hh < 3.0) return vec3(p, v, t);
    if (hh < 4.0) return vec3(p, q, v);
    if (hh < 5.0) return vec3(t, p, v);
    return vec3(v, p, q);
  }

  /* ── contour colour from band + hue ────────── */
  /*    outer = dark, saturated                    */
  /*    inner = bright, desaturated (cream/pastel)  */

  vec3 contourColor(float band, float hue) {
    if (band < 0.5) return vec3(0.0);
    float t = band / 7.0;
    float sat = 1.0 - pow(t, 0.7) * 0.88;
    float val = pow(t, 1.5) * 0.95 + 0.04;
    return hsv2rgb(hue + t * 0.08, sat, val);
  }

  void main() {
    float time = uTime;

    /* ── halftone cell grid ──────────────────────── */
    float cellSize = 4.0;
    vec2 cell = floor(gl_FragCoord.xy / cellSize);
    vec2 cellCenter = (cell + 0.5) * cellSize;
    float halfDiag = cellSize * 0.707;
    float dist = length(gl_FragCoord.xy - cellCenter) / halfDiag;

    float maxDim = max(uResolution.x, uResolution.y);
    vec2 normPos = cellCenter / maxDim;

    /* ── domain warping (gentle) ──────────────────── */
    float wx = snoise(vec3(normPos * 1.0 + 100.0, time * 0.008));
    float wy = snoise(vec3(normPos * 1.0 + 200.0, time * 0.006));
    vec2 warped = normPos + vec2(wx, wy) * 0.18;

    /* ── noise field (slow, large shapes) ────────── */
    float n1 = snoise(vec3(warped * 1.1, time * 0.010));
    float n2 = snoise(vec3(normPos * 0.55 + 50.0, time * 0.007 + 10.0));
    float noiseVal = (n1 * 0.55 + n2 * 0.45) * 0.5 + 0.5;

    /*
     * ── Hue field (separate slow noise) ─────────────
     * Restricted to orange → red → purple → purple-blue
     * (HSV 0.75 → 1.08, wrapping through red at 1.0).
     */
    float hueN1 = snoise(vec3(normPos * 0.9 + 300.0, time * 0.005));
    float hueN2 = snoise(vec3(normPos * 0.5 + 450.0, time * 0.004 + 30.0));
    float hueRaw = (hueN1 * 0.6 + hueN2 * 0.4) * 0.5 + 0.5;
    float hue = mix(0.75, 1.08, hueRaw);

    /*
     * ── Contour edges ───────────────────────────────
     * Slice the noise into N bands. The colour only
     * appears near the EDGES between bands (where
     * fract crosses 0). Everything far from an edge
     * is black.
     */
    float numContours = 5.0;
    float scaled = noiseVal * numContours;
    float edgeDist = min(fract(scaled), 1.0 - fract(scaled));

    /* how wide each coloured ribbon is (smaller = more black) */
    float edgeWidth = 0.26;
    float edgeIntensity = 1.0 - smoothstep(0.0, edgeWidth, edgeDist);

    /*
     * ── Map edge intensity to discrete colour bands ─
     * pow(0.5) expands the outer bands so they occupy
     * more screen space → wider dithering transitions
     * at the dark edges, tighter at the bright center.
     */
    float bandPos = pow(edgeIntensity, 0.7) * 7.0;
    float lo = floor(bandPos);
    float hi = min(lo + 1.0, 7.0);
    float frac = bandPos - lo;

    vec3 loCol = contourColor(lo, hue);
    vec3 hiCol = contourColor(hi, hue);

    /* ── per-cell jitter for organic edges ────────── */
    float jitter = (hash21(cell) - 0.5) * 0.35;
    float threshold = clamp(frac + jitter, 0.0, 1.0);

    /* ── halftone circle dithering between colours ── */
    float dotRadius = threshold * 1.42;
    vec3 outColor = (dist < dotRadius) ? hiCol : loCol;

    gl_FragColor = vec4(outColor, 1.0);
  }
`;

const createShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }

  return shader;
};

const createProgram = (gl: WebGLRenderingContext) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);

  if (!vertexShader || !fragmentShader) {
    if (vertexShader) {
      gl.deleteShader(vertexShader);
    }

    if (fragmentShader) {
      gl.deleteShader(fragmentShader);
    }

    return null;
  }

  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return program;
};

export const ContourLines = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      stencil: false,
    });

    if (!gl) {
      return;
    }

    const program = createProgram(gl);
    const positionBuffer = gl.createBuffer();

    if (!program || !positionBuffer) {
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const resolutionLocation = gl.getUniformLocation(program, "uResolution");
    const timeLocation = gl.getUniformLocation(program, "uTime");

    if (positionLocation === -1 || !resolutionLocation || !timeLocation) {
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      return;
    }

    let raf = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let lastRenderTime = -FRAME_INTERVAL_MS;
    const startedAt = performance.now();

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextDpr = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.ceil(rect.width * nextDpr));
      const nextHeight = Math.max(1, Math.ceil(rect.height * nextDpr));

      if (nextWidth === width && nextHeight === height && nextDpr === dpr) {
        return;
      }

      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolutionLocation, width, height);
      lastRenderTime = -FRAME_INTERVAL_MS;
    };

    const render = (timeMs: number) => {
      resize();

      if (timeMs - lastRenderTime >= FRAME_INTERVAL_MS) {
        lastRenderTime = timeMs;
        gl.uniform1f(timeLocation, (timeMs - startedAt) * 0.001);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      raf = requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        return;
      }

      lastRenderTime = -FRAME_INTERVAL_MS;
      raf = requestAnimationFrame(render);
    };

    const resizeObserver = new ResizeObserver(resize);

    resize();
    resizeObserver.observe(canvas);

    if (prefersReducedMotion) {
      gl.uniform1f(timeLocation, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      return () => {
        resizeObserver.disconnect();
        gl.deleteBuffer(positionBuffer);
        gl.deleteProgram(program);
      };
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 z-0 size-full" />;
};
