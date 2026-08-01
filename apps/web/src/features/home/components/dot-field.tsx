import { cn } from "@quieter/ui/cn";
import { useId } from "react";

/**
 * Dot-matrix light field.
 *
 * Four stacked passes of the same 11px grid, each masked by its own radial
 * falloff, so both dot size and colour respond to a single light source.
 *
 * The SVG is deliberately viewBox-less: patterns use `userSpaceOnUse` so the
 * grid stays a constant 11px at any viewport width, while the gradients use the
 * default `objectBoundingBox` units so the light keeps its relative position.
 */

const ground = (alpha: number) =>
  `color-mix(in oklab, var(--color-bg-elevated) ${alpha}%, transparent)`;

type Layer = {
  color: string;
  cx: number;
  cy: number;
  r: number;
  radius: number;
  stops: [offset: number, opacity: number][];
};

const heroLayers: Layer[] = [
  {
    color: "#98A1B8",
    cx: 0.58,
    cy: 0.98,
    r: 0.9,
    radius: 1.3,
    stops: [
      [0, 0.95],
      [0.38, 0.46],
      [0.7, 0.15],
      [1, 0],
    ],
  },
  {
    color: "#4E72FF",
    cx: 0.14,
    cy: 0.94,
    r: 0.78,
    radius: 1.95,
    stops: [
      [0, 1],
      [0.34, 0.66],
      [0.68, 0.22],
      [1, 0],
    ],
  },
  {
    color: "#4FD4FF",
    cx: 0.79,
    cy: 0.86,
    r: 0.36,
    radius: 2.25,
    stops: [
      [0, 1],
      [0.44, 0.58],
      [1, 0],
    ],
  },
  {
    color: "#F2FAFF",
    cx: 0.82,
    cy: 0.83,
    r: 0.17,
    radius: 2.9,
    stops: [
      [0, 1],
      [0.5, 0.45],
      [1, 0],
    ],
  },
];

/** Mirror of the hero: light enters from the left instead, and no hot core. */
const closingLayers: Layer[] = [
  {
    color: "#98A1B8",
    cx: 0.4,
    cy: 1.02,
    r: 0.88,
    radius: 1.3,
    stops: [
      [0, 0.88],
      [0.38, 0.4],
      [0.72, 0.12],
      [1, 0],
    ],
  },
  {
    color: "#4E72FF",
    cx: 0.74,
    cy: 1.06,
    r: 0.66,
    radius: 1.95,
    stops: [
      [0, 0.9],
      [0.44, 0.42],
      [1, 0],
    ],
  },
  {
    color: "#4FD4FF",
    cx: 0.16,
    cy: 0.94,
    r: 0.3,
    radius: 2.25,
    stops: [
      [0, 0.92],
      [0.46, 0.44],
      [1, 0],
    ],
  },
];

const bloom = {
  closing: {
    background:
      "radial-gradient(closest-side, oklch(0.84 0.1 220 / 0.2) 0%, oklch(0.7 0.13 232 / 0.095) 26%, oklch(0.55 0.16 252 / 0.036) 48%, oklch(0.46 0.14 260 / 0.01) 70%, oklch(0.4 0.1 262 / 0) 88%)",
    className: "-left-[18%] -bottom-[45%] h-[110%] w-[70%]",
  },
  hero: {
    background:
      "radial-gradient(closest-side, oklch(0.86 0.11 218 / 0.3) 0%, oklch(0.72 0.13 226 / 0.145) 24%, oklch(0.56 0.16 248 / 0.058) 46%, oklch(0.46 0.15 260 / 0.016) 68%, oklch(0.4 0.1 262 / 0) 88%)",
    className: "-right-[18%] -bottom-[40%] h-[105%] w-[70%]",
  },
} as const;

type DotFieldProps = {
  className?: string;
  /** Softens the top edge too. Used where the field meets the section above. */
  fadeTop?: boolean;
  variant?: "closing" | "hero";
};

export const DotField = ({ className, fadeTop = false, variant = "hero" }: DotFieldProps) => {
  const uid = useId().replaceAll(":", "");
  const layers = variant === "hero" ? heroLayers : closingLayers;
  const light = bloom[variant];

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div
        className={cn("absolute rounded-full", light.className)}
        style={{ background: light.background }}
      />

      <svg className="absolute inset-0 size-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {layers.map((layer, index) => (
            <pattern
              height="11"
              id={`${uid}-dots-${index}`}
              key={`dots-${layer.color}`}
              patternUnits="userSpaceOnUse"
              width="11"
            >
              <circle cx="5.5" cy="5.5" fill={layer.color} r={layer.radius} />
            </pattern>
          ))}
          {layers.map((layer, index) => (
            <radialGradient
              cx={layer.cx}
              cy={layer.cy}
              id={`${uid}-falloff-${index}`}
              key={`falloff-${layer.color}`}
              r={layer.r}
            >
              {layer.stops.map(([offset, opacity]) => (
                <stop key={offset} offset={offset} stopColor="#fff" stopOpacity={opacity} />
              ))}
            </radialGradient>
          ))}
          {layers.map((layer, index) => (
            <mask id={`${uid}-mask-${index}`} key={`mask-${layer.color}`}>
              <rect fill={`url(#${uid}-falloff-${index})`} height="100%" width="100%" />
            </mask>
          ))}
        </defs>
        {layers.map((layer, index) => (
          <rect
            fill={`url(#${uid}-dots-${index})`}
            height="100%"
            key={`layer-${layer.color}`}
            mask={`url(#${uid}-mask-${index})`}
            width="100%"
          />
        ))}
      </svg>

      {fadeTop ? (
        <div
          className="absolute inset-x-0 top-0 h-70"
          style={{
            background: `linear-gradient(to bottom, var(--color-bg-elevated) 0%, ${ground(94)} 12%, ${ground(60)} 42%, ${ground(16)} 74%, transparent 100%)`,
          }}
        />
      ) : null}

      {variant === "closing" ? (
        <div
          className="absolute inset-x-0 bottom-0 h-37.5"
          style={{
            background: `linear-gradient(to bottom, transparent 0%, ${ground(10)} 38%, ${ground(48)} 72%, ${ground(88)} 92%, var(--color-bg-elevated) 100%)`,
          }}
        />
      ) : null}

      <div
        className="absolute top-[12%] left-1/2 h-[70%] w-[78%] -translate-x-1/2 rounded-full"
        style={{
          background: `radial-gradient(closest-side, ${ground(94)} 0%, ${ground(86)} 34%, ${ground(55)} 60%, ${ground(18)} 82%, transparent 100%)`,
        }}
      />
    </div>
  );
};
