import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";

import { useDeploymentUpdateRequired } from "#/lib/stale-deployment";

export const DeploymentUpdateDialog = () => {
  const updateRequired = useDeploymentUpdateRequired();

  return (
    <AlertDialog
      open={updateRequired}
      onOpenChange={(_, eventDetails) => {
        eventDetails.cancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>A new version is available</AlertDialogTitle>
          <AlertDialogDescription>
            Please reload the site to continue.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload site
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
