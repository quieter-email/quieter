export const inputControlClassName =
  "w-full text-fg transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive";

export const inputControlSizeVariants = {
  default: "h-8 px-2.5 text-body-sm",
  lg: "h-10 px-4 text-body-lg",
  sm: "h-7 px-2 text-body-sm",
} as const;

export const ghostInputClassName =
  "squircle min-w-0 rounded-md border-0 bg-transparent shadow-none read-only:bg-transparent focus-visible:bg-muted focus-visible:ring-0 focus-visible:ring-offset-0 aria-invalid:bg-destructive/10";
