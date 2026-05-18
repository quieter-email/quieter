"use client";

import type { ComponentPropsWithoutRef } from "react";

type SvgIconProps = ComponentPropsWithoutRef<"svg">;

const SvgIcon = ({ children, className, ...props }: SvgIconProps) => (
  <svg aria-hidden className={className} fill="none" viewBox="0 0 16 16" {...props}>
    {children}
  </svg>
);

export const CheckIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="M3.5 8.5 6.5 11.5 12.5 4.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
  </SvgIcon>
);

export const ChevronDownIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="m4 6 4 4 4-4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </SvgIcon>
);

export const ChevronRightIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="m6 4 4 4-4 4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </SvgIcon>
);

export const ChevronUpIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="m4 10 4-4 4 4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </SvgIcon>
);

export const DotIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <circle cx="8" cy="8" fill="currentColor" r="2.5" />
  </SvgIcon>
);

export const MinusIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="M4 8h8"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </SvgIcon>
);

export const PlusIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="M8 4v8M4 8h8"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </SvgIcon>
);

export const EyeIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="M2.25 8s1.9-3.5 5.75-3.5S13.75 8 13.75 8 11.85 11.5 8 11.5 2.25 8 2.25 8Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
    />
    <circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.4" />
  </SvgIcon>
);

export const EyeOffIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d="m3.25 3.25 9.5 9.5M6.2 4.85A5.9 5.9 0 0 1 8 4.5c3.85 0 5.75 3.5 5.75 3.5a8.3 8.3 0 0 1-1.6 1.95M9.6 11.25A6 6 0 0 1 8 11.5C4.15 11.5 2.25 8 2.25 8a8.5 8.5 0 0 1 1.9-2.2"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
    />
    <path
      d="M7.05 6.7a1.6 1.6 0 0 0 2.25 2.25"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
    />
  </SvgIcon>
);
