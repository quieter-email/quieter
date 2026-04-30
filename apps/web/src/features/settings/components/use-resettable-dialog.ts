import { useState } from "react";

export const useResettableDialog = (reset: () => void) => {
  const [open, setOpen] = useState(false);

  return {
    open,
    openDialog: () => {
      reset();
      setOpen(true);
    },
    setDialogOpen: (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) reset();
    },
  };
};
