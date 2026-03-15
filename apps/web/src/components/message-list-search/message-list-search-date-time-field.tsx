"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, Calendar01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar, Input, cn } from "@quietr/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  formatSearchDateTimeDisplayValue,
  getSearchDateTimeTimeValue,
  parseSearchDateTimeValue,
  setSearchDateTimeDate,
  setSearchDateTimeTime,
  type SearchDateFilterId,
} from "./message-list-search-state";

const layoutTransition = {
  damping: 34,
  mass: 0.7,
  stiffness: 360,
  type: "spring" as const,
};

const DATE_FILTER_ICONS = {
  after: ArrowRight01Icon,
  before: ArrowLeft01Icon,
} as const;

export const SearchDateTimeField = ({
  label,
  onChange,
  onOpenChange,
  open,
  value,
  valueKey,
}: {
  label: string;
  onChange: (value: string) => void;
  onOpenChange: (value: SearchDateFilterId | null) => void;
  open: boolean;
  value: string;
  valueKey: SearchDateFilterId;
}) => {
  const selectedDateTime = parseSearchDateTimeValue(value);
  const [month, setMonth] = useState<Date>(selectedDateTime ?? new Date());

  useEffect(() => {
    if (open) setMonth(selectedDateTime ?? new Date());
  }, [open, selectedDateTime]);

  return (
    <motion.div layout className="space-y-1" transition={{ layout: layoutTransition }}>
      <motion.button
        layout="position"
        aria-expanded={open}
        className={cn(
          "flex min-h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
          open && "bg-muted",
        )}
        onClick={() => {
          onOpenChange(open ? null : valueKey);
        }}
        transition={{ layout: layoutTransition }}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          icon={Calendar01Icon}
        />
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
          icon={DATE_FILTER_ICONS[valueKey]}
        />
        <span className="min-w-0 flex-1 truncate">
          {value ? formatSearchDateTimeDisplayValue(value) : label}
        </span>
      </motion.button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key={valueKey}
            layout
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-md border border-input bg-background p-2 shadow-sm"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: -4 }}
            transition={{
              layout: layoutTransition,
              opacity: { duration: 0.16, ease: "easeOut" },
              y: { duration: 0.16, ease: "easeOut" },
            }}
          >
            <div className="space-y-2">
              <Calendar
                mode="single"
                month={month}
                onMonthChange={setMonth}
                onSelect={(nextDate) => {
                  if (!nextDate) return;
                  onChange(setSearchDateTimeDate(value, nextDate));
                }}
                selected={
                  selectedDateTime
                    ? new Date(
                        selectedDateTime.getFullYear(),
                        selectedDateTime.getMonth(),
                        selectedDateTime.getDate(),
                      )
                    : undefined
                }
              />

              <Input
                aria-label={`${label} time`}
                className="text-[13px]"
                disabled={!selectedDateTime}
                onChange={(event) => {
                  onChange(setSearchDateTimeTime(value, event.currentTarget.value));
                }}
                size="sm"
                type="time"
                value={getSearchDateTimeTimeValue(value)}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
};
