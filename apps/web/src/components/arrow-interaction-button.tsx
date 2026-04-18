import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, type ButtonProps } from "@quietr/ui";

export const ArrowInteractionButton = (props: ButtonProps) => {
  return (
    <Button {...props}>
      <HugeiconsIcon icon={ArrowUp01Icon} />
    </Button>
  );
};
