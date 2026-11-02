import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import { useEffect } from "react";

import { useDeploymentUpdateStatus } from "#/lib/stale-deployment";

export const DeploymentUpdateDialog = () => {
  const status = useDeploymentUpdateStatus();

  useEffect(() => {
    if (status === "available") {
      toast.info("A new version is available", {
        description: (
          <div className="grid gap-3">
            <p>
              Reload soon to get the latest updates. You can finish what you are
              doing first.
            </p>
            <Button
              onClick={() => {
                window.location.reload();
              }}
              size="sm"
            >
              Reload site
            </Button>
          </div>
        ),
        duration: 0,
        id: "deployment-update",
      });
    } else {
      toast.dismiss("deployment-update");
    }
    return () => {
      toast.dismiss("deployment-update");
    };
  }, [status]);

  return (
    <AlertDialog
      open={status === "required"}
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
