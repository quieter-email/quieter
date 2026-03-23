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
