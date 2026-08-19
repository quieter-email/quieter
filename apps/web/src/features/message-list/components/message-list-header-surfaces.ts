import { cva } from "class-variance-authority";

/**
 * Control surfaces shared by both message list header rows, so the search view
 * and the selection toolbar stay identical across the swap between them.
 */
export const messageListHeaderControlVariants = cva("", {
  variants: {
    control: {
      chip: "squircle inline-flex h-6 min-w-0 max-w-full shrink-0 items-center rounded-lg bg-control-hover px-2.5 text-body-sm text-fg shadow-xs transition-colors duration-150 ease-out ring-1 ring-border/80 ring-inset hover:bg-control-active focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/45",
      toolbar:
        "h-full w-9 rounded-xl border border-border bg-control text-muted-fg shadow-xs hover:bg-control-hover hover:text-fg [&_svg]:size-3.5",
      trigger:
        "squircle inline-flex h-full w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-control text-muted-fg shadow-xs transition-colors duration-150 ease-out hover:bg-control-hover hover:text-fg active:bg-control-active active:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
    },
  },
});
