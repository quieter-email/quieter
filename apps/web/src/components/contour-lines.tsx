import { useEffect, useRef } from "react";
import { effect, frame, init, surface } from "vgpu";

const FRAME_INTERVAL_MS = 1000 / 30;

const FRAGMENT_SHADER_SOURCE = `
  struct Params {
    resolution: vec2f,
    time: f32,
  }

  @group(0) @binding(0) var<uniform> params: Params;

  fn mod289_4(x: vec4f) -> vec4f {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  fn mod289_3(x: vec3f) -> vec3f {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  fn permute(x: vec4f) -> vec4f {
    return mod289_4(((x * 34.0) + vec4f(1.0)) * x);
  }

  fn taylor_inv_sqrt(r: vec4f) -> vec4f {
    return vec4f(1.79284291400159) - 0.85373472095314 * r;
  }

  fn snoise(v: vec3f) -> f32 {
    let c = vec2f(1.0 / 6.0, 1.0 / 3.0);
    let d = vec4f(0.0, 0.5, 1.0, 2.0);

    var i = floor(v + dot(v, c.yyy));
    let x0 = v - i + dot(i, c.xxx);
    let g = step(x0.yzx, x0.xyz);
    let l = vec3f(1.0) - g;
    let i1 = min(g.xyz, l.zxy);
    let i2 = max(g.xyz, l.zxy);
    let x1 = x0 - i1 + c.xxx;
    let x2 = x0 - i2 + c.yyy;
    let x3 = x0 - d.yyy;

    i = mod289_3(i);
    let p = permute(
      permute(
        permute(vec4f(i.z) + vec4f(0.0, i1.z, i2.z, 1.0)) +
          vec4f(i.y) + vec4f(0.0, i1.y, i2.y, 1.0)
      ) + vec4f(i.x) + vec4f(0.0, i1.x, i2.x, 1.0)
    );

    let n = 0.142857142857;
    let ns = n * d.wyz - d.xzx;
    let j = p - 49.0 * floor(p * ns.z * ns.z);
    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);
    let xn = x_ * ns.x + ns.yyyy;
    let yn = y_ * ns.x + ns.yyyy;
    let h = vec4f(1.0) - abs(xn) - abs(yn);
    let b0 = vec4f(xn.xy, yn.xy);
    let b1 = vec4f(xn.zw, yn.zw);
    let s0 = floor(b0) * 2.0 + vec4f(1.0);
    let s1 = floor(b1) * 2.0 + vec4f(1.0);
    let sh = -step(h, vec4f(0.0));
    let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    let a1 = b1.xzyw + s1.xzyw * sh.zzww;
    var p0 = vec3f(a0.xy, h.x);
    var p1 = vec3f(a0.zw, h.y);
    var p2 = vec3f(a1.xy, h.z);
    var p3 = vec3f(a1.zw, h.w);
    let norm = taylor_inv_sqrt(
      vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))
    );

    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    var m = max(
      vec4f(0.6) - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)),
      vec4f(0.0)
    );
    m *= m;

    return 42.0 * dot(
      m * m,
      vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))
    );
  }

  fn hash21(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
  }

  fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3f {
    let hh = fract(h) * 6.0;
    let f = fract(hh);
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));

    if (hh < 1.0) {
      return vec3f(v, t, p);
    }
    if (hh < 2.0) {
      return vec3f(q, v, p);
    }
    if (hh < 3.0) {
      return vec3f(p, v, t);
    }
    if (hh < 4.0) {
      return vec3f(p, q, v);
    }
    if (hh < 5.0) {
      return vec3f(t, p, v);
    }
    return vec3f(v, p, q);
  }

  fn contour_color(band: f32, hue: f32) -> vec3f {
    if (band < 0.5) {
      return vec3f(0.0);
    }

    let t = band / 7.0;
    let sat = 1.0 - pow(t, 0.7) * 0.88;
    let val = pow(t, 1.5) * 0.95 + 0.04;
    return hsv2rgb(hue + t * 0.08, sat, val);
  }

  @fragment
  fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let frag_coord = vec2f(position.x, params.resolution.y - position.y);
    let cell_size = 4.0;
    let cell = floor(frag_coord / cell_size);
    let cell_center = (cell + vec2f(0.5)) * cell_size;

    let max_dim = max(params.resolution.x, params.resolution.y);
    let norm_pos = cell_center / max_dim;

    let wx = snoise(vec3f(norm_pos * 1.0 + vec2f(100.0), params.time * 0.008));
    let wy = snoise(vec3f(norm_pos * 1.0 + vec2f(200.0), params.time * 0.006));
    let warped = norm_pos + vec2f(wx, wy) * 0.18;

    let n1 = snoise(vec3f(warped * 1.1, params.time * 0.010));
    let n2 = snoise(vec3f(norm_pos * 0.55 + vec2f(50.0), params.time * 0.007 + 10.0));
    let noise_val = (n1 * 0.55 + n2 * 0.45) * 0.5 + 0.5;

    let hue_n1 = snoise(vec3f(norm_pos * 0.9 + vec2f(300.0), params.time * 0.005));
    let hue_n2 = snoise(vec3f(norm_pos * 0.5 + vec2f(450.0), params.time * 0.004 + 30.0));
    let hue_raw = (hue_n1 * 0.6 + hue_n2 * 0.4) * 0.5 + 0.5;
    let hue = mix(0.75, 1.08, hue_raw);

    let scaled = noise_val * 5.0;
    let edge_dist = min(fract(scaled), 1.0 - fract(scaled));
    let edge_intensity = 1.0 - smoothstep(0.0, 0.26, edge_dist);
    let band_pos = pow(edge_intensity, 0.7) * 7.0;
    let lo = floor(band_pos);
    let hi = min(lo + 1.0, 7.0);
    let band_fraction = band_pos - lo;
    let lo_color = contour_color(lo, hue);
    let hi_color = contour_color(hi, hue);
    let jitter = (hash21(cell) - 0.5) * 0.35;
    let threshold = clamp(band_fraction + jitter, 0.0, 1.0);
    let out_color = select(
      lo_color,
      hi_color,
      hash21(cell + vec2f(19.0, 71.0)) < threshold,
    );

    return vec4f(out_color, 1.0);
  }
`;

export const ContourLines = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    let disposed = false;
    let raf = 0;
    let gpu: Awaited<ReturnType<typeof init>> | undefined;
    let canvasSurface: ReturnType<typeof surface> | undefined;
    let removeResizeListener: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let removeVisibilityListener: (() => void) | undefined;

    void (async () => {
      try {
        const initializedGpu = await init();

        if (disposed) {
          initializedGpu.dispose();
          return;
        }

        gpu = initializedGpu;
        const activeSurface = surface(initializedGpu, canvas, { dpr: [1, 2] });
        canvasSurface = activeSurface;

        const contourEffect = effect(initializedGpu, FRAGMENT_SHADER_SOURCE, {
          label: "contour-lines",
          set: {
            params: {
              resolution: activeSurface.size,
              time: 0,
            },
          },
        });

        let compilation: ReturnType<typeof contourEffect.compile> | undefined;
        frame(initializedGpu, () => {
          compilation = contourEffect.compile(activeSurface);
        });
        if (!compilation) {
          throw new Error("Failed to start contour pipeline compilation");
        }
        await compilation;

        if (disposed) {
          return;
        }

        const prefersReducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        const startedAt = performance.now();
        let lastRenderTime = -FRAME_INTERVAL_MS;

        const renderFrame = (time: number) => {
          contourEffect.set({
            params: {
              resolution: activeSurface.size,
              time,
            },
          });
          frame(initializedGpu, (currentFrame) => {
            currentFrame.pass(activeSurface, contourEffect);
          });
        };

        const render = (timeMs: number) => {
          if (timeMs - lastRenderTime >= FRAME_INTERVAL_MS) {
            lastRenderTime = timeMs;
            renderFrame((timeMs - startedAt) * 0.001);
          }

          raf = requestAnimationFrame(render);
        };

        const handleVisibilityChange = () => {
          if (document.hidden) {
            cancelAnimationFrame(raf);
            raf = 0;
            return;
          }

          lastRenderTime = -FRAME_INTERVAL_MS;
          raf = requestAnimationFrame(render);
        };

        removeResizeListener = activeSurface.onResize(({ width, height }) => {
          contourEffect.set({ params: { resolution: [width, height] } });
          lastRenderTime = -FRAME_INTERVAL_MS;
        });

        if (prefersReducedMotion) {
          resizeObserver = new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
              raf = 0;
              renderFrame(0);
            });
          });
          resizeObserver.observe(canvas);
          renderFrame(0);
          return;
        }

        document.addEventListener("visibilitychange", handleVisibilityChange);
        removeVisibilityListener = () => {
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
          );
        };

        if (!document.hidden) {
          raf = requestAnimationFrame(render);
        }
      } catch {
        canvasSurface?.dispose();
        gpu?.dispose();
        canvasSurface = undefined;
        gpu = undefined;
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      removeResizeListener?.();
      removeVisibilityListener?.();
      canvasSurface?.dispose();
      gpu?.dispose();
    };
  }, []);

  return (
    <canvas
      aria-hidden
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 size-full"
    />
  );
};
