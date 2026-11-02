import { cva } from "class-variance-authority";

export const entranceMotionVariants = cva(
  "duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) starting:opacity-0 motion-reduce:transition-opacity",
  {
    defaultVariants: { effect: "fade" },
    variants: {
      effect: {
        fade: "transition-opacity",
        pop: "transition-[opacity,scale] motion-safe:starting:scale-[0.98]",
        slide:
          "transition-[opacity,translate] motion-safe:starting:translate-y-1",
      },
    },
  }
);
