import { TextInput } from "react-native";
import type { TextInputProps } from "react-native";
import { useResolveClassNames } from "uniwind";

import { cn } from "#/lib/cn";

type TextFieldProps = TextInputProps & {
  className?: string;
};

export const TextField = ({ className, ...props }: TextFieldProps) => {
  const { color } = useResolveClassNames("text-muted-fg");
  return (
    <TextInput
      className={cn(
        "h-10 rounded-md border border-border bg-input px-3 text-body text-fg",
        className
      )}
      placeholderTextColor={color}
      {...props}
    />
  );
};
