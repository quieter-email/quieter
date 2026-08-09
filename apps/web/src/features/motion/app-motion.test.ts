import { describe, expect, it } from "vite-plus/test";

import {
  appMotionDuration,
  getAppFlyInMotion,
  getAppPresenceMotion,
  getAppStaggerDelay,
} from "./app-motion";

describe("app motion", () => {
  it("caps group stagger without delaying the first item", () => {
    expect(getAppStaggerDelay(0)).toBe(0);
    expect(getAppStaggerDelay(3)).toBe(0.12);
    expect(getAppStaggerDelay(50)).toBe(0.16);
  });

  it("removes movement, blur, and stagger for reduced motion entrances", () => {
    const motion = getAppFlyInMotion({
      animate: true,
      index: 4,
      reducedMotion: true,
    });

    expect(motion.initial).toStrictEqual({ opacity: 0 });
    expect(motion.transition).toMatchObject({
      delay: 0,
      duration: appMotionDuration.feedback,
    });
  });

  it("keeps reduced motion presence changes opacity-only", () => {
    const motion = getAppPresenceMotion({ reducedMotion: true });

    expect(motion.initial).toStrictEqual({ opacity: 0 });
    expect(motion.exit).toStrictEqual({ opacity: 0 });
  });
});
