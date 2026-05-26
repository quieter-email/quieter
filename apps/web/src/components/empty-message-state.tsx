import { LazyMotion, domAnimation, m } from "motion/react";
import { VerticalSlot } from "~/components/vertical-slot";

export const EmptyMessageState = ({
  description = "Select an email to view.",
  title = "Nothing here yet",
}: {
  description?: string | null;
  title?: string | null;
}) => (
  <LazyMotion features={domAnimation}>
    <div className="flex flex-1 items-center justify-center">
      <div className="relative max-w-sm p-8">
        <m.div
          aria-hidden
          className="squircle pointer-events-none absolute top-1/2 left-1/2 size-52 -translate-x-1/2 -translate-y-1/2 rounded-5xl border"
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: 45, opacity: 1 }}
          transition={{
            ease: "easeOut",
            duration: 1,
          }}
        />
        <VerticalSlot className="relative z-10 text-center">
          <div>
            {title && (
              <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
            )}
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          </div>
        </VerticalSlot>
      </div>
    </div>
  </LazyMotion>
);
