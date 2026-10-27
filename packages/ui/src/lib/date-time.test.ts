import { describe, expect, it } from "vite-plus/test";

import { parseDateValue, parseTimeValue } from "./date-time";

describe("date picker values", () => {
  it("accepts leap days without rolling invalid dates into the next month", () => {
    expect(parseDateValue("2024-02-29")?.getDate()).toBe(29);
    for (const value of [
      "2023-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-01",
      "2026-01-00",
      "2026-1-1",
      "",
      "0000-01-01",
    ]) {
      expect(parseDateValue(value)).toBeUndefined();
    }
  });

  it("preserves years below one hundred without the Date constructor century offset", () => {
    expect(parseDateValue("0099-01-02")?.getFullYear()).toBe(99);
  });
});

describe("time picker input", () => {
  it("accepts arbitrary minutes and converts twelve-hour boundaries", () => {
    expect(parseTimeValue(" 2:37 pm ")).toBe("14:37");
    expect(parseTimeValue("12:01 AM")).toBe("00:01");
    expect(parseTimeValue("12 pm")).toBe("12:00");
    expect(parseTimeValue("23:59")).toBe("23:59");
    expect(parseTimeValue("0:00")).toBe("00:00");
  });

  it("rejects out-of-range and ambiguous partial input", () => {
    for (const value of [
      "24:00",
      "14:60",
      "0 AM",
      "13 PM",
      "12:3",
      "14:00:30",
      "-1",
      "",
      "noon",
    ]) {
      expect(parseTimeValue(value)).toBeUndefined();
    }
  });
});
