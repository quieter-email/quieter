import { cn } from "@quieter/ui";
import { type ComponentPropsWithoutRef, useEffect, useId, useRef } from "react";

type LoadingSpinnerProps = ComponentPropsWithoutRef<"div">;

const maxDevicePixelRatio = 2;
const spriteSize = 64;
const particleCount = 260;
const squircleExponent = 4;
const layerCount = 3;
const particleStride = 9;
const fallbackViewBoxSize = 100;
const tau = Math.PI * 2;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const seededRandom = (index: number, salt: number) => {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453123;
  return value - Math.floor(value);
};

// Per particle: squircle point (sx, sy), outward normal (nx, ny), perimeter
// position t, radial jitter, size seed, layer depth (0 outer .. 1 inner).
const particles = (() => {
  const values = new Float32Array(particleCount * particleStride);
  const power = 2 / squircleExponent;

  for (let index = 0; index < particleCount; index += 1) {
    const t = index / particleCount;
    const angle = t * tau;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const unitX = Math.sign(cosine) * Math.abs(cosine) ** power;
    const unitY = Math.sign(sine) * Math.abs(sine) ** power;
    const squircleX = (unitX - unitY) * Math.SQRT1_2;
    const squircleY = (unitX + unitY) * Math.SQRT1_2;
    const length = Math.hypot(squircleX, squircleY) || 1;
    const layer = Math.floor(seededRandom(index, 1) * layerCount);
    const depth = layer / (layerCount - 1);
    const base = index * particleStride;

    values[base] = squircleX * (1 - depth * 0.34);
    values[base + 1] = squircleY * (1 - depth * 0.34);
    values[base + 2] = squircleX / length;
    values[base + 3] = squircleY / length;
    values[base + 4] = t;
    values[base + 5] = seededRandom(index, 2) * 2 - 1;
    values[base + 6] = 0.55 + seededRandom(index, 3) * 0.9;
    values[base + 7] = depth;
    values[base + 8] = seededRandom(index, 4) * tau;
  }

  return values;
})();

type ParticleFrame = {
  alpha: number;
  radius: number;
  x: number;
  y: number;
};

const setParticleFrame = (
  frame: ParticleFrame,
  index: number,
  elapsed: number,
  minSide: number,
  centerX: number,
  centerY: number,
  radiusScale = 1,
) => {
  const base = index * particleStride;
  const squircleX = particles[base];
  const squircleY = particles[base + 1];
  const normalX = particles[base + 2];
  const normalY = particles[base + 3];
  const t = particles[base + 4];
  const jitter = particles[base + 5];
  const sizeSeed = particles[base + 6];
  const depth = particles[base + 7];
  const phase = particles[base + 8];
  const angle = t * tau;
  const wobbleAmp = minSide * 0.012;
  const jitterBand = minSide * 0.009;
  const dotUnit = minSide * 0.013;
  const head = (elapsed * 0.55) % 1;
  const wobble =
    Math.sin(angle * 2 + elapsed * 1.3 + phase) * 0.7 +
    Math.sin(angle * 3 - elapsed * 0.9 + depth * 2 + phase * 1.7) * 0.3;
  const offset = wobble * wobbleAmp + jitter * jitterBand;

  let delta = t - head;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;

  const cometWidth = delta < 0 ? 0.3 : 0.1;
  const comet = Math.exp(-((delta / cometWidth) ** 2));
  const brightness = clamp(0.4 + (sizeSeed - 0.55) * 0.78, 0.4, 1);
  const drift = Math.sin(elapsed * (0.9 + sizeSeed * 0.5) + phase * 2.3) * 0.5 + 0.5;
  const layerAlpha = 0.5 + (1 - depth) * 0.5;

  frame.x = centerX + squircleX * minSide * 0.3 * radiusScale + normalX * offset;
  frame.y = centerY + squircleY * minSide * 0.3 * radiusScale + normalY * offset;
  frame.radius = sizeSeed * (0.6 + comet * 1.15) * (1 - depth * 0.3) * dotUnit;
  frame.alpha = clamp((0.08 + drift * 0.1 + comet * 0.62) * layerAlpha * brightness, 0, 1);
};

const fallbackParticles = Array.from({ length: particleCount }, (_, index) => {
  const frame = { alpha: 0, radius: 0, x: 0, y: 0 };
  setParticleFrame(frame, index, 0, fallbackViewBoxSize, 0, 0);
  return frame;
});

let colorCanvas: HTMLCanvasElement | null = null;

const readColor = (element: HTMLElement) => {
  colorCanvas ??= document.createElement("canvas");
  colorCanvas.width = 1;
  colorCanvas.height = 1;

  const context = colorCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "0, 0, 0";

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = getComputedStyle(element).color;
  context.fillRect(0, 0, 1, 1);

  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `${red}, ${green}, ${blue}`;
};

const createSprite = (rgb: string) => {
  const sprite = document.createElement("canvas");
  sprite.width = spriteSize;
  sprite.height = spriteSize;

  const context = sprite.getContext("2d");
  if (!context) return sprite;

  const half = spriteSize / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(${rgb}, 1)`);
  gradient.addColorStop(0.45, `rgba(${rgb}, 0.92)`);
  gradient.addColorStop(0.74, `rgba(${rgb}, 0.28)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, spriteSize, spriteSize);

  return sprite;
};

export const LoadingSpinner = ({ className, ...props }: LoadingSpinnerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<SVGSVGElement>(null);
  const gradientId = `${useId().replaceAll(":", "")}-loading-spinner-dot`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let sprite = createSprite(readColor(canvas));
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let startTime = 0;
    let canvasReady = false;
    const frame = { alpha: 0, radius: 0, x: 0, y: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio);
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));

      if (nextWidth === width && nextHeight === height) return;

      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
    };

    const draw = (time: number) => {
      if (!startTime) startTime = time;

      const elapsed = reducedMotion ? 0 : (time - startTime) / 1000;
      const minSide = Math.min(width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const breathe = 1 + Math.sin(elapsed * 1.1) * 0.022;

      context.clearRect(0, 0, width, height);

      for (let index = 0; index < particleCount; index += 1) {
        setParticleFrame(frame, index, elapsed, minSide, centerX, centerY, breathe);
        context.globalAlpha = frame.alpha;
        context.drawImage(
          sprite,
          frame.x - frame.radius,
          frame.y - frame.radius,
          frame.radius * 2,
          frame.radius * 2,
        );
      }

      if (!canvasReady) {
        canvasReady = true;
        canvas.classList.remove("opacity-0");
        fallbackRef.current?.classList.add("opacity-0");
      }

      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    resize();
    draw(performance.now());

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw(performance.now());
    });
    resizeObserver.observe(canvas);

    const mutationObserver = new MutationObserver(() => {
      sprite = createSprite(readColor(canvas));
      if (reducedMotion) draw(performance.now());
    });
    mutationObserver.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div {...props} className={cn("relative isolate size-20 text-primary", className)}>
      <svg
        className="absolute inset-0 size-full text-primary transition-opacity duration-150"
        ref={fallbackRef}
        viewBox={`-${fallbackViewBoxSize / 2} -${fallbackViewBoxSize / 2} ${fallbackViewBoxSize} ${fallbackViewBoxSize}`}
      >
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0" stopColor="currentColor" stopOpacity="1" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.92" />
            <stop offset="74%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        {fallbackParticles.map((particle, index) => (
          <circle
            cx={particle.x}
            cy={particle.y}
            fill={`url(#${gradientId})`}
            key={index}
            opacity={particle.alpha}
            r={particle.radius}
          />
        ))}
      </svg>
      <canvas
        className="absolute inset-0 size-full opacity-0 transition-opacity duration-150"
        ref={canvasRef}
      />
    </div>
  );
};
