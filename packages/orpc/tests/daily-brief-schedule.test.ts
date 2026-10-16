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

  test("resolves a weekly local schedule across a daylight-saving gap", () => {
    const run = nextDailyBriefRun({
      cadence: "weekly",
      localTime: "02:30",
      now: new Date("2026-03-23T12:00:00Z"),
      timeZone: "Europe/Berlin",
      weekday: 0,
    });
    expect(dailyBriefLocalClock(run, "Europe/Berlin")).toMatchObject({
      date: "2026-03-29",
      time: "03:00",
    });
    const following = nextDailyBriefRun({
      afterLocalDate: "2026-03-29",
      cadence: "weekly",
      localTime: "02:30",
      now: run,
      timeZone: "Europe/Berlin",
      weekday: 0,
    });
    expect(dailyBriefLocalClock(following, "Europe/Berlin")).toMatchObject({
      date: "2026-04-05",
      time: "02:30",
    });
  });

  test("chooses the next weekly occurrence after today's scheduled time", () => {
    const run = nextDailyBriefRun({
      cadence: "weekly",
      localTime: "06:00",
      now: new Date("2026-10-12T06:00:00Z"),
      timeZone: "Pacific/Honolulu",
      weekday: 0,
    });
    expect(dailyBriefLocalClock(run, "Pacific/Honolulu")).toMatchObject({
      date: "2026-10-18",
      time: "06:00",
    });
  });

  test("includes midnight in the earliest timezone when the weekly run is several days away", () => {
    const run = nextDailyBriefRun({
      cadence: "weekly",
      localTime: "00:00",
      now: new Date("2026-10-12T06:00:00Z"),
      timeZone: "Pacific/Kiritimati",
      weekday: 0,
    });
    expect(dailyBriefLocalClock(run, "Pacific/Kiritimati")).toMatchObject({
      date: "2026-10-18",
      time: "00:00",
    });
  });
});
