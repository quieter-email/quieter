import type { ComponentPropsWithoutRef } from "react";

import brandIcon from "../../assets/brand-icon.svg?url";
import { brand } from "../../lib/brand-geometry";

type BrandProps = ComponentPropsWithoutRef<"svg"> & {
  variant?: "mark" | "wordmark" | "combination";
};

export const Brand = ({ variant = "mark", ...props }: BrandProps) => {
  const artwork = brand[variant];
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox={`0 0 ${artwork.width} ${artwork.height}`}
      {...props}
    >
      {variant === "mark" ? (
        <image height={artwork.height} href={brandIcon} width={artwork.width} />
      ) : (
        <path d={artwork.path} />
      )}
    </svg>
  );
};
