export const pressScaleClassName =
  "active:scale-[var(--press-scale,0.97)] motion-reduce:active:scale-100";

// Cap the inset of each edge while preserving the scale of compact controls.
const PRESS_INSET_PX = 2;
const MIN_PRESS_SCALE = 0.97;

export const measurePressScale = (element: HTMLElement) => {
  const inset = PRESS_INSET_PX * 2;
  const scaleX = Math.max(MIN_PRESS_SCALE, 1 - inset / element.offsetWidth);
  const scaleY = Math.max(MIN_PRESS_SCALE, 1 - inset / element.offsetHeight);
  element.style.setProperty("--press-scale", `${scaleX} ${scaleY}`);
};
