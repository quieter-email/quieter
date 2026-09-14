import { brand } from "@quieter/brand";
import Svg, { Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

import { cn } from "#/lib/cn";

type BrandMarkProps = {
  className?: string;
  height: number;
  variant?: "combination" | "mark";
  width: number;
};

/**
 * The web brand artwork renders the same path data (`@quieter/brand`) through
 * react-native-svg, so the logo matches the web mark exactly.
 */
export const BrandMark = ({
  className,
  height,
  variant = "mark",
  width,
}: BrandMarkProps) => {
  const artwork = brand[variant];
  const { color } = useResolveClassNames(cn("text-fg", className));

  return (
    <Svg
      height={height}
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${artwork.width} ${artwork.height}`}
      width={width}
    >
      <Path d={artwork.path} fill={color} />
    </Svg>
  );
};
