import type { ComponentProps } from "solid-js";
import * as FileFieldPrimitive from "@kobalte/core/file-field";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type FileFieldProps = ComponentProps<typeof FileFieldPrimitive.Root>;

export const FileField = (props: FileFieldProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <FileFieldPrimitive.Root class={cn("grid w-full gap-1.5", local.class)} {...others} />;
};

export type FileFieldLabelProps = ComponentProps<typeof FileFieldPrimitive.Label>;

export const FileFieldLabel = (props: FileFieldLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type FileFieldTriggerProps = ComponentProps<typeof FileFieldPrimitive.Trigger>;

export const FileFieldTrigger = (props: FileFieldTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.Trigger
      class={cn(
        "inline-flex h-10 w-fit items-center justify-center border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-all hover:-translate-y-px hover:border-foreground/25 hover:bg-muted/60 hover:shadow-md active:translate-y-0 active:shadow-sm",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type FileFieldDropzoneProps = ComponentProps<typeof FileFieldPrimitive.Dropzone>;

export const FileFieldDropzone = (props: FileFieldDropzoneProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.Dropzone
      class={cn(
        "grid min-h-32 place-items-center border border-dashed border-input bg-muted/25 px-4 py-6 text-center text-sm text-muted-foreground transition-colors",
        "hover:border-foreground/30 hover:bg-muted/40 data-disabled:pointer-events-none data-disabled:opacity-50 data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/10",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type FileFieldHiddenInputProps = ComponentProps<typeof FileFieldPrimitive.HiddenInput>;

export const FileFieldHiddenInput = (props: FileFieldHiddenInputProps) => (
  <FileFieldPrimitive.HiddenInput {...props} />
);

export type FileFieldItemListProps = ComponentProps<typeof FileFieldPrimitive.ItemList>;

export const FileFieldItemList = (props: FileFieldItemListProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <FileFieldPrimitive.ItemList class={cn("grid gap-2", local.class)} {...others} />;
};

export type FileFieldItemProps = ComponentProps<typeof FileFieldPrimitive.Item>;

export const FileFieldItem = (props: FileFieldItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.Item
      class={cn(
        "flex items-center gap-2 border border-border bg-background px-3 py-2",
        local.class,
      )}
      {...others}
    />
  );
};

export type FileFieldItemPreviewProps = ComponentProps<typeof FileFieldPrimitive.ItemPreview>;

export const FileFieldItemPreview = (props: FileFieldItemPreviewProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.ItemPreview
      class={cn("grid size-9 shrink-0 place-items-center border bg-muted/40 text-xs", local.class)}
      {...others}
    />
  );
};

export type FileFieldItemPreviewImageProps = ComponentProps<
  typeof FileFieldPrimitive.ItemPreviewImage
>;

export const FileFieldItemPreviewImage = (props: FileFieldItemPreviewImageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.ItemPreviewImage
      class={cn("size-full object-cover", local.class)}
      {...others}
    />
  );
};

export type FileFieldItemNameProps = ComponentProps<typeof FileFieldPrimitive.ItemName>;

export const FileFieldItemName = (props: FileFieldItemNameProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.ItemName
      class={cn("min-w-0 flex-1 truncate text-sm", local.class)}
      {...others}
    />
  );
};

export type FileFieldItemSizeProps = ComponentProps<typeof FileFieldPrimitive.ItemSize>;

export const FileFieldItemSize = (props: FileFieldItemSizeProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.ItemSize
      class={cn("shrink-0 text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type FileFieldItemDeleteTriggerProps = ComponentProps<
  typeof FileFieldPrimitive.ItemDeleteTrigger
>;

export const FileFieldItemDeleteTrigger = (props: FileFieldItemDeleteTriggerProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <FileFieldPrimitive.ItemDeleteTrigger
      class={cn(
        "inline-flex h-8 items-center justify-center border border-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    >
      {local.children ?? "Remove"}
    </FileFieldPrimitive.ItemDeleteTrigger>
  );
};

export type FileFieldDescriptionProps = ComponentProps<typeof FileFieldPrimitive.Description>;

export const FileFieldDescription = (props: FileFieldDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.Description
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type FileFieldErrorMessageProps = ComponentProps<typeof FileFieldPrimitive.ErrorMessage>;

export const FileFieldErrorMessage = (props: FileFieldErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <FileFieldPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
