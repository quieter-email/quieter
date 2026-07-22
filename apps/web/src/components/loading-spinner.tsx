import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@quieter/ui/cn";

type LoadingSpinnerProps = ComponentPropsWithoutRef<"svg">;

const logoOutlinePath =
  "M84 50C84 56.44 79.2 62.5 70.8 70.8C62.5 79.2 56.44 84 50 84C43.56 84 37.5 79.2 29.2 70.8C20.8 62.5 16 56.44 16 50C16 43.56 20.8 37.5 29.2 29.2C37.5 20.8 43.56 16 50 16C56.44 16 62.5 20.8 70.8 29.2C79.2 37.5 84 43.56 84 50Z";

const trailOpacities = [
  0.02, 0.03, 0.045, 0.06, 0.08, 0.105, 0.135, 0.17, 0.21, 0.255, 0.305, 0.36, 0.42, 0.48, 0.545,
  0.61, 0.675, 0.735, 0.79, 0.84, 0.885, 0.925, 0.96, 1,
];

export const LoadingSpinner = ({ className, ...props }: LoadingSpinnerProps) => (
  <svg
    {...props}
    aria-hidden="true"
    className={cn("size-20 overflow-visible text-primary", className)}
    fill="none"
    focusable="false"
    viewBox="0 0 100 100"
  >
    <path
      d={logoOutlinePath}
      opacity="0.12"
      pathLength="100"
      stroke="currentColor"
      strokeWidth="2.25"
    />
    {trailOpacities.map((opacity, index) => (
      <path
        className="loading-spinner-segment"
        d={logoOutlinePath}
        key={opacity}
        opacity={opacity}
        stroke="currentColor"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="2.5"
        style={{ animationDelay: `${index * -12}ms` }}
      />
    ))}
  </svg>
);
