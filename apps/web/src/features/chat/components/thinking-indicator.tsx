import { domAnimation, LazyMotion, m } from "motion/react";

export const ThinkingIndicator = () => (
  <LazyMotion features={domAnimation}>
    <m.div
      animate={{ opacity: 1 }}
      className="flex items-center gap-2 py-2"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <span className="flex items-center gap-1">
        <m.span
          animate={{ opacity: [0.3, 1, 0.3] }}
          className="size-1.5 rounded-full bg-muted-foreground/50"
          transition={{ duration: 1.4, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
        />
        <m.span
          animate={{ opacity: [0.3, 1, 0.3] }}
          className="size-1.5 rounded-full bg-muted-foreground/50"
          transition={{
            delay: 0.2,
            duration: 1.4,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
        <m.span
          animate={{ opacity: [0.3, 1, 0.3] }}
          className="size-1.5 rounded-full bg-muted-foreground/50"
          transition={{
            delay: 0.4,
            duration: 1.4,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
      </span>
    </m.div>
  </LazyMotion>
);
