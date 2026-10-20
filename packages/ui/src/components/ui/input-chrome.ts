export const inputControlClassName =
  "w-full text-fg transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/45";

export const inputControlSizeVariants = {
  default: "h-8 px-2.5 text-body-sm",
  lg: "h-10 px-4 text-body-lg",
  sm: "h-7 px-2 text-body-sm",
} as const;
