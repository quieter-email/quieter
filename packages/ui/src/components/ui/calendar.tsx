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
    className={cn("quietr-calendar w-fit", className)}
    classNames={{
      ...defaultClassNames,
      root: cn("w-fit text-sm text-foreground", defaultClassNames.root),
      months: cn("flex flex-col gap-4 sm:flex-row", defaultClassNames.months),
      month: cn("relative flex w-full flex-col gap-4", defaultClassNames.month),
      month_caption: cn(
        "flex h-8 items-center justify-center px-8",
        defaultClassNames.month_caption,
      ),
      caption_label: cn("text-sm font-medium text-foreground", defaultClassNames.caption_label),
      nav: cn(
        "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
        defaultClassNames.nav,
      ),
      button_previous: cn(
        buttonVariants({ size: "icon-sm", variant: "ghost" }),
        "absolute top-0 left-0 size-7 rounded-md bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground",
        defaultClassNames.button_previous,
      ),
      button_next: cn(
        buttonVariants({ size: "icon-sm", variant: "ghost" }),
        "absolute top-0 right-0 size-7 rounded-md bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground",
        defaultClassNames.button_next,
      ),
      chevron: cn("text-current", defaultClassNames.chevron),
      month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
      weekdays: cn("grid grid-cols-7 gap-0.5", defaultClassNames.weekdays),
      weekday: cn(
        "flex h-8 items-center justify-center text-[11px] font-medium text-muted-foreground",
        defaultClassNames.weekday,
      ),
      weeks: cn("flex flex-col gap-0.5", defaultClassNames.weeks),
      week: cn("grid grid-cols-7 gap-0.5", defaultClassNames.week),
      day: cn("flex size-8 items-center justify-center p-0 text-sm", defaultClassNames.day),
      day_button: cn(
        buttonVariants({ size: "icon-sm", variant: "ghost" }),
        "size-8 rounded-md bg-transparent p-0 text-[13px] font-normal text-foreground ring-offset-0 hover:bg-muted hover:text-foreground",
        defaultClassNames.day_button,
      ),
      today: cn(
        "[&>button]:font-medium [&>button]:ring-1 [&>button]:ring-border",
        defaultClassNames.today,
      ),
      selected: cn(
        "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:shadow-sm [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground [&>button]:focus:bg-primary [&>button]:focus:text-primary-foreground",
        defaultClassNames.selected,
      ),
      outside: cn(
        "text-muted-foreground/45 [&>button]:text-muted-foreground/45",
        defaultClassNames.outside,
      ),
      disabled: cn(
        "text-muted-foreground/35 [&>button]:cursor-not-allowed [&>button]:opacity-50",
        defaultClassNames.disabled,
      ),
      hidden: cn("invisible", defaultClassNames.hidden),
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
