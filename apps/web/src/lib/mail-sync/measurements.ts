import type { SyncClientEvent } from "@quieter/sync-client/types";

type MeasurementName =
  | Extract<SyncClientEvent, { type: "measurement" }>["name"]
  | "navigation-prepared"
  | "navigation-ready-ms"
  | "cache-bytes"
  | "cache-quota-error";
type Measurement = {
  count: number;
  total: number;
  max: number;
  samples: number[];
};
const measurements = new Map<MeasurementName, Measurement>();
const listeners = new Set<(name: MeasurementName, value: number) => void>();

export const recordMailSyncMeasurement = (
  name: MeasurementName,
  value: number
) => {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  const entry = measurements.get(name) ?? {
    count: 0,
    max: 0,
    samples: [],
    total: 0,
  };
  entry.count += 1;
  entry.total += value;
  entry.max = Math.max(entry.max, value);
  entry.samples.push(value);
  if (entry.samples.length > 250) {
    entry.samples.shift();
  }
  measurements.set(name, entry);
  for (const listener of listeners) {
    listener(name, value);
  }
};

export const getMailSyncMeasurements = () =>
  Object.fromEntries(
    [...measurements].map(([name, entry]) => {
      const sorted = entry.samples.toSorted((left, right) => left - right);
      return [
        name,
        {
          count: entry.count,
          max: entry.max,
          mean: entry.total / entry.count,
          p99: sorted[Math.floor(sorted.length * 0.99)],
        },
      ];
    })
  );

export const subscribeMailSyncMeasurements = (
  listener: (name: MeasurementName, value: number) => void
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
