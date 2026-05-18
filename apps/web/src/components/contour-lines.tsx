import { useEffect, useRef } from "react";

const FRAME_INTERVAL_MS = 1000 / 24;

const VERTEX_SHADER_SOURCE = `
  attribute vec2 aPosition;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  #extension GL_OES_standard_derivatives : enable

  precision highp float;

  uniform vec2 uResolution;
  uniform vec2 uCssResolution;
  uniform float uTime;

  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
  }

  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

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
    vec4 x = floor(j * ns.z);
    vec4 y = floor(j - 7.0 * x);
    vec4 x_ = x * ns.x + ns.yyyy;
    vec4 y_ = y * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x_) - abs(y_);
    vec4 b0 = vec4(x_.xy, y_.xy);
    vec4 b1 = vec4(x_.zw, y_.zw);
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

  vec4 colorRamp(float progress) {
    float position = pow(clamp(progress, 0.0, 1.0), 1.8) * 8.0;
    float segment = floor(position);
    float t = position - segment;
    vec4 c0 = vec4(0.078, 0.722, 0.651, 0.16);
    vec4 c1 = vec4(0.176, 0.831, 0.749, 0.24);
    vec4 c2 = vec4(0.133, 0.827, 0.933, 0.32);
    vec4 c3 = vec4(0.376, 0.647, 0.980, 0.42);
    vec4 c4 = vec4(0.506, 0.549, 0.973, 0.52);
    vec4 c5 = vec4(0.659, 0.333, 0.969, 0.64);
    vec4 c6 = vec4(0.851, 0.275, 0.937, 0.76);
    vec4 c7 = vec4(0.957, 0.447, 0.714, 0.86);
    vec4 c8 = vec4(0.973, 0.443, 0.443, 0.94);

    if (segment < 1.0) {
      return mix(c0, c1, t);
    }

    if (segment < 2.0) {
      return mix(c1, c2, t);
    }

    if (segment < 3.0) {
      return mix(c2, c3, t);
    }

    if (segment < 4.0) {
      return mix(c3, c4, t);
    }

    if (segment < 5.0) {
      return mix(c4, c5, t);
    }

    if (segment < 6.0) {
      return mix(c5, c6, t);
    }

    if (segment < 7.0) {
      return mix(c6, c7, t);
    }

    return mix(c7, c8, clamp(t, 0.0, 1.0));
  }

  void main() {
    vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) * (uCssResolution / uResolution);
    float time = uTime;

    float heightField = snoise(vec3(pixel * 0.00175, time * 0.014)) * 0.5 + 0.5;
    float bands = heightField * 11.0;
    float bandDistance = min(fract(bands), 1.0 - fract(bands));
    float distancePixels = bandDistance / max(fwidth(bands), 0.000001);
    float contourLine = 1.0 - smoothstep(0.58, 1.76, distancePixels);
    float contourGlow = 1.0 - smoothstep(1.0, 13.0, distancePixels);

    vec2 colorDrift = vec2(sin(time * 0.095) * 120.0, cos(time * 0.085) * 120.0);
    float colorField = snoise(vec3((pixel + colorDrift) * 0.001, time * 0.025 + 100.0)) * 0.5 + 0.5;
    float colorProgress = (colorField - 0.62) / 0.38;
    vec4 ramp = colorRamp(colorProgress);
    float colorFade = smoothstep(0.0, 1.0, colorProgress / 0.18);
    float colorMask = max(contourLine, contourGlow * 0.2);
    float colorAlpha = colorMask * ramp.a * colorFade;
    float greyAlpha = contourLine * 0.06;
    float totalAlpha = clamp(greyAlpha + colorAlpha * (1.0 - greyAlpha), 0.0, 0.97);
    vec3 grey = vec3(0.06, 0.09, 0.16);
    vec3 color = grey;

    if (totalAlpha > 0.0) {
      color = (grey * greyAlpha + ramp.rgb * colorAlpha * (1.0 - greyAlpha)) / totalAlpha;
    }

    gl_FragColor = vec4(color, totalAlpha);
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
      alpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      stencil: false,
    });

    if (!gl || !gl.getExtension("OES_standard_derivatives")) {
      return;
    }

    const program = createProgram(gl);
    const positionBuffer = gl.createBuffer();

    if (!program || !positionBuffer) {
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const resolutionLocation = gl.getUniformLocation(program, "uResolution");
    const cssResolutionLocation = gl.getUniformLocation(program, "uCssResolution");
    const timeLocation = gl.getUniformLocation(program, "uTime");

    if (positionLocation === -1 || !resolutionLocation || !cssResolutionLocation || !timeLocation) {
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
    gl.clearColor(0, 0, 0, 0);

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
      gl.uniform2f(cssResolutionLocation, width / dpr, height / dpr);
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

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 z-0 size-full bg-transparent opacity-50"
    />
  );
};
