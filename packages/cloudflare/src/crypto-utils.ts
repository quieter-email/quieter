const hasTimingSafeEqual = (
  subtle: SubtleCrypto
): subtle is SubtleCrypto & {
  timingSafeEqual: (left: ArrayBuffer, right: ArrayBuffer) => boolean;
} =>
  "timingSafeEqual" in subtle && typeof subtle.timingSafeEqual === "function";

export const timingSafeEqual = (left: ArrayBuffer, right: ArrayBuffer) => {
  if (!hasTimingSafeEqual(crypto.subtle)) {
    throw new Error("timingSafeEqual is unavailable.");
  }
  return crypto.subtle.timingSafeEqual(left, right);
};
