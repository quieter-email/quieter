import { domAnimation, LazyMotion, m } from "motion/react";

export const ThinkingIndicator = () => (
  <LazyMotion features={domAnimation}>
    <m.div
      animate={{ opacity: 1 }}
      className="flex items-center gap-1.5 py-1"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {[0, 0.15, 0.3].map((delay) => (
        <m.span
          animate={{ opacity: [0.2, 0.8, 0.2] }}
          className="size-1 rounded-full bg-muted-foreground"
          key={delay}
          transition={{ delay, duration: 1.6, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
        />
      ))}
    </m.div>
  </LazyMotion>
);
