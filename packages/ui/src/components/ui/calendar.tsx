"use client";

import type { ComponentProps } from "react";
import { cva } from "class-variance-authority";
import { format } from "date-fns";
import { DayPicker, getDefaultClassNames, type ChevronProps } from "react-day-picker";
import { cn } from "../../lib/cn";
import { ChevronDownIcon } from "./icons";

const defaultClassNames = getDefaultClassNames();

const calendarChevronVariants = cva("size-4", {
  variants: {
    orientation: {
      left: "rotate-90",
      right: "-rotate-90",
      down: "",
      up: "rotate-180",
    },
  },
  defaultVariants: {
    orientation: "left",
  },
});

const CalendarChevron = ({ className, orientation = "left" }: ChevronProps) => (
  <ChevronDownIcon className={cn(calendarChevronVariants({ orientation }), className)} />
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
  <div className="@container">
    <DayPicker
      animate={animate}
      className={cn("quieter-calendar w-fit", className)}
      classNames={{
        ...defaultClassNames,
        root: cn("w-fit text-sm text-foreground", defaultClassNames.root),
        months: cn("flex flex-col gap-4 @xl:flex-row", defaultClassNames.months),
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
          "absolute top-0 left-0 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground outline-hidden transition-transform duration-100 ease-out select-none squircle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          "absolute top-0 right-0 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground outline-hidden transition-transform duration-100 ease-out select-none squircle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
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
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-[13px] font-normal text-foreground outline-hidden transition-transform duration-100 ease-out select-none squircle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
  </div>
);
