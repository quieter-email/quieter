"use client";

import { ConsentDraftProvider, useConsentDraft } from "@c15t/react";
import { useHeadlessConsentUI, useTranslations } from "@c15t/react/headless";
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

const ConsentPreferencesDialogContent = () => {
  const translations = useTranslations();
  const { displayedCategories, set, values } = useConsentDraft();
  const { performDialogAction, saveCustomPreferences } = useHeadlessConsentUI();

  return (
    <DialogContent className="w-[min(92vw,34rem)]">
      <DialogHeader>
        <DialogTitle>{translations.consentManagerDialog.title}</DialogTitle>
        <DialogDescription>
          {translations.consentManagerDialog.description}
        </DialogDescription>
      </DialogHeader>

      <DialogBody
        // oxlint-disable-next-line shadcn/no-restyle -- Consent list keeps its flush-top body.
        className="pt-0"
        spacing="4"
      >
        {displayedCategories.map((category) => {
          const copy = translations.consentTypes[category];
          const isDisabled = category === "necessary";

          return (
            <div
              className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-b-0 last:pb-0"
              key={category}
            >
              <div className="min-w-0">
                <p className="text-body font-medium text-fg">
                  {copy?.title ?? category}
                </p>
                <p className="mt-1 text-body/6 text-muted-fg">
                  {copy?.description ?? ""}
                </p>
              </div>

              <Switch
                aria-label={copy?.title ?? category}
                checked={values[category]}
                className="shrink-0"
                size="sm"
                disabled={isDisabled}
                onCheckedChange={(checked) => {
                  set(category, checked);
                }}
              >
                <SwitchThumb />
              </Switch>
            </div>
          );
        })}
      </DialogBody>

      <DialogFooter>
        <Button
          onClick={() => {
            void performDialogAction("reject");
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          {translations.common.rejectAll}
        </Button>

        <Button
          onClick={() => {
            void performDialogAction("accept");
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          {translations.common.acceptAll}
        </Button>
        <Button
          onClick={() => {
            void saveCustomPreferences();
          }}
          size="sm"
          type="button"
        >
          {translations.common.save}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

export const ConsentPreferencesDialog = () => {
  const { closeUI, dialog, openDialog } = useHeadlessConsentUI();

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
      {dialog.isVisible ? (
        <ConsentDraftProvider>
          <ConsentPreferencesDialogContent />
        </ConsentDraftProvider>
      ) : null}
    </Dialog>
  );
};
