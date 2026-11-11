import type { CSSProperties } from "react";

import { Surface } from "./surface";
import { Text } from "./text";

type SegmentStyle = CSSProperties & {
  "--segment-color": string;
  "--segment-size": number;
};

export const CompositionChart = ({
  description,
  segments,
  title,
}: {
  description: string;
  segments: { color: string; label: string; value: number }[];
  title: string;
}) => {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const breakdown = segments.map(({ color, label, value }) => {
    const style: SegmentStyle = {
      "--segment-color": color,
      "--segment-size": value,
    };
    return { label, style, value };
  });
  return (
    <Surface padding="comfortable">
      <figure className="space-y-4">
        <figcaption className="space-y-1">
          <Text as="h3" size="sm" weight="medium">
            {title}
          </Text>
          <Text size="caption" tone="muted">
            {description}
          </Text>
        </figcaption>
        <div
          aria-hidden="true"
          className="flex h-2.5 overflow-hidden rounded-full bg-detail not-squircle"
        >
          {breakdown.map(({ label, style }) => (
            <div
              className="grow-(--segment-size) bg-(--segment-color)"
              key={label}
              style={style}
            />
          ))}
        </div>
        <dl className="space-y-2">
          {breakdown.map(({ label, style, value }) => (
            <div className="flex items-baseline gap-3" key={label}>
              <dt className="flex min-w-0 flex-1 items-center gap-2 text-body-sm">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-xs bg-(--segment-color)"
                  style={style}
                />
                {label}
              </dt>
              <dd className="text-caption text-muted-fg tabular-nums">
                {total > 0
                  ? (value / total).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                      style: "percent",
                    })
                  : "0%"}
              </dd>
              <dd className="w-12 text-right text-body-sm tabular-nums">
                {value.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </figure>
    </Surface>
  );
};
