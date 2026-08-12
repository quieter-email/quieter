"use client";

import { cva } from "class-variance-authority";
import { format } from "date-fns";
import type { ComponentProps } from "react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import type { ChevronProps } from "react-day-picker";

import { cn } from "../../lib/cn";
import { ChevronDownIcon } from "./icons";

const defaultClassNames = getDefaultClassNames();

const calendarChevronVariants = cva("size-4", {
  defaultVariants: {
    orientation: "left",
  },
  variants: {
    orientation: {
      down: "",
      left: "rotate-90",
      right: "-rotate-90",
      up: "rotate-180",
    },
  },
});

const CalendarChevron = ({ className, orientation = "left" }: ChevronProps) => (
  <ChevronDownIcon
    className={cn(calendarChevronVariants({ orientation }), className)}
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
  <div className="@container">
    <DayPicker
      animate={animate}
      className={cn("quieter-calendar w-fit", className)}
      classNames={{
        ...defaultClassNames,
        button_next: cn(
          "squircle absolute top-0 right-0 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-fg transition-transform duration-100 ease-out select-none hover:bg-muted hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
          defaultClassNames.button_next
        ),
        button_previous: cn(
          "squircle absolute top-0 left-0 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-fg transition-transform duration-100 ease-out select-none hover:bg-muted hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
          defaultClassNames.button_previous
        ),
        caption_label: cn(
          "text-sm font-medium text-fg",
          defaultClassNames.caption_label
        ),
        chevron: cn("text-current", defaultClassNames.chevron),
        day: cn(
          "flex size-8 items-center justify-center p-0 text-sm",
          defaultClassNames.day
        ),
        day_button: cn(
          "squircle inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-[13px] font-normal text-fg transition-transform duration-100 ease-out select-none hover:bg-muted hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          defaultClassNames.day_button
        ),
        disabled: cn(
          "text-muted-fg/35 [&>button]:cursor-not-allowed [&>button]:opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        month: cn(
          "relative flex w-full flex-col gap-4",
          defaultClassNames.month
        ),
        month_caption: cn(
          "flex h-8 items-center justify-center px-8",
          defaultClassNames.month_caption
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        months: cn(
          "flex flex-col gap-4 @xl:flex-row",
          defaultClassNames.months
        ),
        nav: cn(
          "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
          defaultClassNames.nav
        ),
        outside: cn(
          "text-muted-fg/45 [&>button]:text-muted-fg/45",
          defaultClassNames.outside
        ),
        root: cn("w-fit text-sm text-fg", defaultClassNames.root),
        selected: cn(
          "[&>button]:bg-primary [&>button]:text-primary-fg [&>button]:shadow-sm [&>button]:hover:bg-primary [&>button]:hover:text-primary-fg [&>button]:focus:bg-primary [&>button]:focus:text-primary-fg",
          defaultClassNames.selected
        ),
        today: cn(
          "[&>button]:font-medium [&>button]:ring-1 [&>button]:ring-border",
          defaultClassNames.today
        ),
        week: cn("grid grid-cols-7 gap-0.5", defaultClassNames.week),
        weekday: cn(
          "flex h-8 items-center justify-center text-micro font-medium text-muted-fg",
          defaultClassNames.weekday
        ),
        weekdays: cn("grid grid-cols-7 gap-0.5", defaultClassNames.weekdays),
        weeks: cn("flex flex-col gap-0.5", defaultClassNames.weeks),
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
