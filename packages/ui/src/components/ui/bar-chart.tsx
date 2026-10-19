"use client";

import type { CSSProperties } from "react";

import { cn } from "../../lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export type BarChartSeries = {
  color: string;
  key: string;
  label: string;
};

export type BarChartPoint = {
  label: string;
  shortLabel: string;
  values: Record<string, number>;
};

type ChartStyle = CSSProperties & {
  "--chart-color"?: string;
  "--chart-columns"?: string;
  "--chart-height"?: string;
};

export const BarChart = ({
  data,
  emptyMessage = "No activity in this period",
  label,
  series,
}: {
  data: BarChartPoint[];
  emptyMessage?: string;
  label: string;
  series: BarChartSeries[];
}) => {
  const maximum = Math.max(
    0,
    ...data.flatMap((point) =>
      series.map((item) => point.values[item.key] ?? 0)
    )
  );
  const ceiling = Math.max(2, Math.ceil(maximum / 2) * 2);
  const tickEvery = Math.max(1, Math.ceil((data.length - 1) / 4));

  return (
    <figure
      aria-label={label}
      className="flex min-w-0 flex-col gap-4"
      style={
        {
          "--chart-columns": `repeat(${data.length}, minmax(0, 1fr))`,
        } as ChartStyle
      }
    >
      <div className="flex h-48 gap-3">
        <div
          aria-hidden="true"
          className="flex w-8 shrink-0 flex-col justify-between text-right text-micro leading-none text-muted-fg tabular-nums"
        >
          {[ceiling, ceiling / 2, 0].map((value) => (
            <span key={value}>
              {value.toLocaleString(undefined, { notation: "compact" })}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col justify-between"
          >
            {[0, 1, 2].map((line) => (
              <div
                className="border-t border-dashed border-border/70"
                key={line}
              />
            ))}
          </div>
          {maximum === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-caption text-muted-fg">
              {emptyMessage}
            </div>
          ) : null}
          <div className="relative grid h-full grid-cols-(--chart-columns) gap-1">
            {data.map((point) => (
              <Tooltip key={point.label}>
                <TooltipTrigger
                  aria-label={`${point.label}, ${series.map((item) => `${item.label} ${point.values[item.key] ?? 0}`).join(", ")}`}
                  className="flex h-full min-w-0 items-end justify-center gap-px rounded-sm px-0.5 hover:bg-fg/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {series.map((item) => {
                    const value = point.values[item.key] ?? 0;
                    return (
                      <span
                        aria-hidden="true"
                        className="h-(--chart-height) w-full max-w-4 rounded-t-sm bg-(--chart-color)"
                        key={item.key}
                        style={
                          {
                            "--chart-color": item.color,
                            "--chart-height": `${(value / ceiling) * 100}%`,
                          } as ChartStyle
                        }
                      />
                    );
                  })}
                </TooltipTrigger>
                <TooltipContent>
                  <p className="mb-2 font-medium">{point.label}</p>
                  <div className="flex min-w-32 flex-col gap-1.5">
                    {series.map((item) => (
                      <div className="flex items-center gap-2" key={item.key}>
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-xs bg-(--chart-color)"
                          style={{ "--chart-color": item.color } as ChartStyle}
                        />
                        <span className="flex-1">{item.label}</span>
                        <span className="tabular-nums">
                          {(point.values[item.key] ?? 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="ml-11 grid grid-cols-(--chart-columns) gap-1 text-micro text-muted-fg"
      >
        {data.map((point, index) => (
          <span
            className={cn("text-center whitespace-nowrap", {
              invisible: index % tickEvery !== 0 && index !== data.length - 1,
            })}
            key={point.label}
          >
            {point.shortLabel}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-caption text-muted-fg">
        {series.map((item) => (
          <span className="inline-flex items-center gap-2" key={item.key}>
            <span
              aria-hidden="true"
              className="size-2 rounded-xs bg-(--chart-color)"
              style={{ "--chart-color": item.color } as ChartStyle}
            />
            {item.label}
          </span>
        ))}
      </div>
    </figure>
  );
};
