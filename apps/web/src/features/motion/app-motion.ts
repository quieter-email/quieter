export const appEaseOut = [0.23, 1, 0.32, 1] as const;
export const appEaseInOut = [0.77, 0, 0.175, 1] as const;

export const appMotionDuration = {
  enter: 0.24,
  feedback: 0.16,
  layout: 0.28,
} as const;

export const appMotionStagger = {
  maxDelay: 0.16,
  step: 0.04,
} as const;

export const getAppStaggerDelay = (index: number) =>
  Math.min(Math.max(index, 0) * appMotionStagger.step, appMotionStagger.maxDelay);

type AppFlyInOptions = {
  animate: boolean;
  axis?: "x" | "y";
  distance?: number;
  index?: number;
  reducedMotion: boolean | null;
};

export const getAppFlyInMotion = ({
  animate,
  axis = "y",
  distance = 8,
  index = 0,
  reducedMotion,
}: AppFlyInOptions) => {
  const initialTransform =
    axis === "x" ? `translate3d(${-distance}px, 0, 0)` : `translate3d(0, ${distance}px, 0)`;

  return {
    animate: {
      filter: "blur(0px)",
      opacity: 1,
      transform: "translate3d(0, 0, 0)",
    },
    initial: animate
      ? reducedMotion
        ? { opacity: 0 }
        : {
            filter: "blur(6px)",
            opacity: 0,
            transform: initialTransform,
          }
      : false,
    transition: {
      delay: animate && !reducedMotion ? getAppStaggerDelay(index) : 0,
      duration: reducedMotion ? appMotionDuration.feedback : appMotionDuration.enter,
      ease: appEaseOut,
    },
  } as const;
};

export const getAppPresenceMotion = ({
  distance = 6,
  reducedMotion,
}: {
  distance?: number;
  reducedMotion: boolean | null;
}) =>
  ({
    animate: {
      opacity: 1,
      transform: "translate3d(0, 0, 0)",
    },
    exit: reducedMotion
      ? { opacity: 0 }
      : {
          opacity: 0,
          transform: `translate3d(0, ${-distance / 2}px, 0)`,
        },
    initial: reducedMotion
      ? { opacity: 0 }
      : {
          opacity: 0,
          transform: `translate3d(0, ${distance}px, 0)`,
        },
    transition: {
      duration: reducedMotion ? appMotionDuration.feedback : appMotionDuration.enter,
      ease: appEaseOut,
    },
  }) as const;
