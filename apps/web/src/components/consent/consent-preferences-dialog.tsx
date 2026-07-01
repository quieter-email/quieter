"use client";

import { useConsentManager, useHeadlessConsentUI, useTranslations } from "@c15t/react";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Switch, SwitchThumb } from "@quieter/ui/switch";

export const ConsentPreferencesDialog = () => {
  const translations = useTranslations();
  const { getDisplayedConsents, selectedConsents, setSelectedConsent } = useConsentManager();
  const { closeUI, dialog, openDialog, performDialogAction, saveCustomPreferences } =
    useHeadlessConsentUI();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          openDialog();
          return;
        }

        closeUI();
      }}
      open={dialog.isVisible}
    >
      <DialogContent className="w-[min(92vw,34rem)]">
        <DialogHeader>
          <DialogTitle>{translations.consentManagerDialog.title}</DialogTitle>
          <DialogDescription>{translations.consentManagerDialog.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pt-0">
          {getDisplayedConsents().map((config) => {
            const category = config.name;
            const copy = translations.consentTypes[category];
            const isDisabled = category === "necessary" || config.disabled === true;

            return (
              <div
                className="flex items-start justify-between gap-4 border-b border-border/70 pb-4 last:border-b-0 last:pb-0"
                key={category}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{copy?.title ?? category}</p>
                  <p className="mt-1 text-sm/6 text-muted-foreground">{copy?.description ?? ""}</p>
                </div>

                <Switch
                  aria-label={copy?.title ?? category}
                  checked={selectedConsents[category]}
                  className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
                  disabled={isDisabled}
                  onCheckedChange={(checked) => {
                    setSelectedConsent(category, checked);
                  }}
                >
                  <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
                </Switch>
              </div>
            );
          })}
        </DialogBody>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            onClick={() => {
              void performDialogAction("reject");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {translations.common.rejectAll}
          </Button>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              onClick={() => {
                void saveCustomPreferences();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {translations.common.save}
            </Button>
            <Button
              onClick={() => {
                void performDialogAction("accept");
              }}
              size="sm"
              type="button"
            >
              {translations.common.acceptAll}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
