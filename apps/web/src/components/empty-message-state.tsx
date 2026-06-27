import { m } from "motion/react";
import { VerticalSlot } from "~/components/vertical-slot";

const waveDots = Array.from({ length: 20 }, (_, index) => ({
  column: index % 10,
  id: index,
}));

export const EmptyMessageState = ({
  description = "Select an email to view.",
  title = "Nothing here yet",
}: {
  description?: string | null;
  title?: string | null;
}) => (
  <div className="flex flex-1 items-center justify-center">
    <div className="max-w-sm p-8 text-center">
      <div aria-hidden className="mx-auto mb-6 grid w-max grid-cols-10 gap-1.5">
        {waveDots.map(({ column, id }) => (
          <m.span
            animate={{ opacity: [0, 0.5, 0] }}
            className="size-1.5 bg-muted-foreground"
            key={id}
            transition={{
              delay: (9 - column) * 0.18,
              duration: 2,
              ease: "easeInOut",
              repeat: Infinity,
              repeatDelay: 0,
            }}
          />
        ))}
      </div>
      <VerticalSlot>
        <div>
          {title ? (
            <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
          ) : null}
          {description ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </VerticalSlot>
    </div>
  </div>
);
