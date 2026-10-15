import { describe, expect, test } from "vite-plus/test";

import {
  dailyBriefLocalClock,
  nextDailyBriefRun,
} from "../src/daily-brief-schedule";

describe("Daily Brief timezone transitions", () => {
  test("runs at the first valid local minute after a spring-forward gap", () => {
    const run = nextDailyBriefRun({
      localTime: "02:30",
      now: new Date("2026-03-28T12:00:00Z"),
      timeZone: "Europe/Berlin",
    });
    expect(dailyBriefLocalClock(run, "Europe/Berlin")).toMatchObject({
      date: "2026-03-29",
      time: "03:00",
    });
  });

  test("chooses the first fall-back occurrence and schedules the next local day after it", () => {
    const first = nextDailyBriefRun({
      localTime: "02:30",
      now: new Date("2026-10-24T12:00:00Z"),
      timeZone: "Europe/Berlin",
    });
    expect(first.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    const next = nextDailyBriefRun({
      localTime: "02:30",
      now: first,
      timeZone: "Europe/Berlin",
    });
    expect(dailyBriefLocalClock(next, "Europe/Berlin")).toMatchObject({
      date: "2026-10-26",
      time: "02:30",
    });
  });

  test("supports offsets that do not use whole hours", () => {
    const run = nextDailyBriefRun({
      localTime: "06:15",
      now: new Date("2026-10-15T00:00:00Z"),
      timeZone: "Asia/Kathmandu",
    });
    expect(run.toISOString()).toBe("2026-10-15T00:30:00.000Z");
  });

  test("does not repeat an already completed local day when a generation spans the fall-back clock change", () => {
    const run = nextDailyBriefRun({
      afterLocalDate: "2026-10-25",
      localTime: "02:30",
      now: new Date("2026-10-25T01:05:00Z"),
      timeZone: "Europe/Berlin",
    });
    expect(dailyBriefLocalClock(run, "Europe/Berlin")).toMatchObject({
      date: "2026-10-26",
      time: "02:30",
    });
  });
});
