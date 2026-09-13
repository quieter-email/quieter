import { describe, expect, test, vi } from "vite-plus/test";

import { createForegroundControl } from "./foreground-control";

describe("foreground control", () => {
  test("inactive cancellation does not notify subscribers or advance generation", () => {
    const control = createForegroundControl();
    const notify = vi.fn<() => void>();
    const subscription = control.state.subscribe(notify);
    control.cancel();
    expect(notify).not.toHaveBeenCalled();
    const generation = control.begin();
    control.cancel();
    notify.mockClear();
    control.cancel();
    expect(notify).not.toHaveBeenCalled();
    expect(control.state.get().generation).toBe(generation + 1);
    subscription.unsubscribe();
  });

  test("cancelling invalidates the active generation", () => {
    const control = createForegroundControl();
    const generation = control.begin();

    control.claimLeg(generation);
    control.cancel();

    expect(control.isCurrent(generation)).toBeFalsy();
    expect(control.state.get()).toMatchObject({
      active: false,
      generation: generation + 1,
    });
    expect(() => {
      control.claimLeg(generation);
    }).toThrow(/stopped/u);
  });

  test("rejects stale generations after a later request starts", () => {
    const control = createForegroundControl();
    const firstGeneration = control.begin();
    const currentGeneration = control.begin();

    expect(control.isCurrent(firstGeneration)).toBeFalsy();
    expect(control.isCurrent(currentGeneration)).toBeTruthy();
    expect(() => {
      control.claimLeg(firstGeneration);
    }).toThrow(/stopped/u);
  });

  test("limits a request to twelve legs", () => {
    const control = createForegroundControl();
    const generation = control.begin();

    for (let leg = 0; leg < 12; leg += 1) {
      control.claimLeg(generation);
    }

    expect(() => {
      control.claimLeg(generation);
    }).toThrow(/stopped/u);
  });

  test("expires the request at its deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));
    const control = createForegroundControl();
    const generation = control.begin();

    vi.setSystemTime(new Date("2026-09-13T12:02:00.000Z"));

    expect(control.isCurrent(generation)).toBeFalsy();
    expect(() => {
      control.claimLeg(generation);
    }).toThrow(/stopped/u);
    vi.useRealTimers();
  });
});
