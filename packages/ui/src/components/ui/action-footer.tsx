import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const ActionFooter = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "flex w-full flex-wrap items-center gap-2 *:grow *:basis-0",
      className
    )}
    data-slot="action-footer"
    {...props}
  />
);
