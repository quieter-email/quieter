import { LazyMotion, domAnimation, m } from "motion/react";

export const EmptyMessageState = ({
  description = "Select an email to view.",
  title = "Nothing here yet",
}: {
  description?: string;
  title?: string;
}) => (
  <LazyMotion features={domAnimation}>
    <div className="grid h-full min-h-56 place-items-center">
      <div className="relative max-w-sm px-8 py-8">
        <m.div
          aria-hidden
          className="squircle pointer-events-none absolute top-1/2 left-1/2 size-52 -translate-x-1/2 -translate-y-1/2 rounded-5xl border border-border"
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: 45, opacity: 1 }}
          transition={{
            rotate: { type: "spring", bounce: 0.25, visualDuration: 2 },
            opacity: { ease: "easeIn", duration: 0.5 },
          }}
        />
        <div className="relative z-10 text-center">
          <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  </LazyMotion>
);
