"use client";

import type { ComponentProps } from "react";
import { format } from "date-fns";
import { DayPicker, getDefaultClassNames, type ChevronProps } from "react-day-picker";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { ChevronDownIcon } from "./icons";

const defaultClassNames = getDefaultClassNames();

const CalendarChevron = ({ className, orientation = "left" }: ChevronProps) => (
  <ChevronDownIcon
    className={cn(
      "size-4",
      orientation === "left" && "rotate-90",
      orientation === "right" && "-rotate-90",
      orientation === "up" && "rotate-180",
      className,
    )}
  />
);

export type CalendarProps = ComponentProps<typeof DayPicker>;

export const Calendar = ({
  animate = false,
  className,
  classNames,
  components,
  fixedWeeks = true,
  formatters,
  navLayout = "around",
  showOutsideDays = true,
  ...props
}: CalendarProps) => (
  <DayPicker
    animate={animate}
    className={cn("quietr-calendar w-fit rounded-lg p-2", className)}
    classNames={{
      ...defaultClassNames,
      root: cn("w-fit text-sm text-foreground", defaultClassNames.root),
      months: "flex",
      month: "space-y-3",
      month_caption: "relative flex h-8 items-center justify-center px-8",
      caption_label: "text-sm font-medium text-foreground",
      nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
      button_previous: cn(
        buttonVariants({ size: "icon-sm", variant: "ghost" }),
        "size-7 rounded-md text-muted-foreground hover:text-foreground",
      ),
      button_next: cn(
        buttonVariants({ size: "icon-sm", variant: "ghost" }),
        "size-7 rounded-md text-muted-foreground hover:text-foreground",
      ),
      chevron: "text-current",
      month_grid: "w-full border-collapse",
      weekdays: "grid grid-cols-7",
      weekday: "flex h-8 items-center justify-center text-[11px] font-normal text-muted-foreground",
      week: "mt-1 grid grid-cols-7",
      day: "flex size-8 items-center justify-center p-0 text-sm",
      day_button: cn(
        buttonVariants({ size: "icon-sm", variant: "ghost" }),
        "size-8 rounded-md p-0 text-[13px] font-normal text-foreground ring-offset-0",
      ),
      today: "[&>button]:font-medium",
      selected:
        "[&>button]:bg-foreground [&>button]:text-background [&>button]:hover:bg-foreground [&>button]:active:bg-foreground",
      outside: "text-muted-foreground/45",
      disabled: "text-muted-foreground/35",
      hidden: "invisible",
      ...classNames,
    }}
    components={{
      Chevron: CalendarChevron,
      ...components,
    }}
    fixedWeeks={fixedWeeks}
    formatters={{
      formatWeekdayName: (date) => format(date, "EEEEE"),
      ...formatters,
    }}
    navLayout={navLayout}
    showOutsideDays={showOutsideDays}
    {...props}
  />
);
