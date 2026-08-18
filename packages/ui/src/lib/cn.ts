import { cx } from "class-variance-authority";
import type { ClassValue } from "class-variance-authority/types";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Our type scale lives in `@theme`, so tailwind-merge does not recognise
 * `text-body` and friends as font sizes. Left unregistered it files them under
 * text-colour, and a colour later in the same merge silently evicts the size
 * (`cn("text-micro", "text-q-gray")` used to drop `text-micro` entirely).
 * Every scale step from `styles.css` has to be listed here.
 */
const fontSizes = [
  "display-lg",
  "display-md",
  "title-lg",
  "title-md",
  "title-sm",
  "body-lg",
  "body",
  "body-sm",
  "caption",
  "micro",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: fontSizes }],
    },
  },
});

export const cn = (...classes: ClassValue[]) => twMerge(cx(classes));
