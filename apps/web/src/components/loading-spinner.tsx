import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cn } from "@quieter/ui";

type LoadingSpinnerProps = ComponentPropsWithoutRef<"div">;

const particleCount = 128;
const squircleExponent = 3.5;
const viewBoxSize = 100;
const duration = 1.8;
const tau = Math.PI * 2;
const squircleRadius = 30;
const arcSampleCount = 4096;

const round = (value: number) => Math.round(value * 1e6) / 1e6;

const seededRandom = (index: number, salt: number) => {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453123;
  return value - Math.floor(value);
};

type SpinnerParticle = {
  bright: number;
  delay: number;
  dim: number;
  radius: number;
  x: number;
  y: number;
};

const squirclePower = 2 / squircleExponent;

const squirclePoint = (angle: number) => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const unitX = Math.sign(cosine) * Math.abs(cosine) ** squirclePower;
  const unitY = Math.sign(sine) * Math.abs(sine) ** squirclePower;

  return {
    x: (unitX - unitY) * Math.SQRT1_2 * squircleRadius,
    y: (unitX + unitY) * Math.SQRT1_2 * squircleRadius,
  };
};

const arcLengths = (() => {
  const lengths = [0];
  let total = 0;

  for (let index = 1; index <= arcSampleCount; index += 1) {
    const previous = squirclePoint(((index - 1) / arcSampleCount) * tau);
    const current = squirclePoint((index / arcSampleCount) * tau);
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(total);
  }

  return { lengths, total };
})();

const angleAtArcLength = (target: number) => {
  const { lengths, total } = arcLengths;
  const clamped = ((target % total) + total) % total;

  let low = 1;
  let high = arcSampleCount;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (lengths[mid]! < clamped) low = mid + 1;
    else high = mid;
  }

  const segmentStart = lengths[low - 1]!;
  const segmentEnd = lengths[low]!;
  const segmentT =
    segmentEnd > segmentStart ? (clamped - segmentStart) / (segmentEnd - segmentStart) : 0;

  const angleStart = ((low - 1) / arcSampleCount) * tau;
  const angleEnd = (low / arcSampleCount) * tau;
  return angleStart + segmentT * (angleEnd - angleStart);
};

const particles: SpinnerParticle[] = (() => {
  const { total } = arcLengths;
  const result: SpinnerParticle[] = [];

  for (let index = 0; index < particleCount; index += 1) {
    const t = index / particleCount;
    const { x, y } = squirclePoint(angleAtArcLength(t * total));
    const seed = 0.5 + seededRandom(index, 3) * 0.5;

    result.push({
      bright: round(0.45 + seed * 0.45),
      delay: round(-t * duration),
      dim: round(0.03 + seed * 0.04),
      radius: round((0.7 + seed * 0.55) * 1.1),
      x: round(x),
      y: round(y),
    });
  }

  return result;
})();

export const LoadingSpinner = ({ className, ...props }: LoadingSpinnerProps) => (
  <div {...props} className={cn("relative isolate size-20 text-primary", className)} role="status">
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full"
      viewBox={`-${viewBoxSize / 2} -${viewBoxSize / 2} ${viewBoxSize} ${viewBoxSize}`}
    >
      {particles.map((particle, index) => (
        <circle
          className="loading-spinner-dot"
          cx={particle.x}
          cy={particle.y}
          fill="currentColor"
          key={index}
          r={particle.radius}
          style={
            {
              "--_bright": particle.bright,
              "--_dim": particle.dim,
              animationDelay: `${particle.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  </div>
);
