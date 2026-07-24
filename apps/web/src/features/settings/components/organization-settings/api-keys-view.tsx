"use client";

import {
  Add01Icon,
  Delete02Icon,
  Key02Icon,
  Loading03Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { FieldLabel } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectScrollDownArrow,
  SelectScrollUpArrow,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import {
  SettingsBackButton,
  SettingsRow,
  SettingsRows,
  settingsRowPaddingClass,
} from "../settings-layout";
import { getOrganizationApiKeysQueryKey, organizationApiKeysQueryOptions } from "./api-keys";
import { formatCount, type FullOrganization } from "./domain";
import { MutedActionButton } from "./settings-row";

type OrganizationApiKey = {
  createdAt: Date;
  enabled: boolean;
  expiresAt: Date | null;
  id: string;
  lastRequest: Date | null;
  name: string | null;
  prefix: string | null;
  start: string | null;
};

const DEFAULT_API_KEY_PREFIX = "quieter_";

const expirationOptions = [
  { label: "1 week", value: "one_week", seconds: 60 * 60 * 24 * 7 },
  { label: "1 month", value: "one_month", seconds: 60 * 60 * 24 * 30 },
  { label: "3 months", value: "three_months", seconds: 60 * 60 * 24 * 90 },
  { label: "6 months", value: "six_months", seconds: 60 * 60 * 24 * 180 },
  { label: "1 year", value: "one_year", seconds: 60 * 60 * 24 * 365 },
  { label: "3 years", value: "three_years", seconds: 60 * 60 * 24 * 365 * 3 },
  { label: "Never", value: "never", seconds: null },
] as const;

type ExpirationValue = (typeof expirationOptions)[number]["value"];

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

const formatApiKeyDate = (value: Date | string | null) => {
  if (!value) return "Never";

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const formatApiKeyPreview = (apiKey: OrganizationApiKey) => {
  const prefix = apiKey.prefix?.trim() || DEFAULT_API_KEY_PREFIX;

  if (apiKey.start && apiKey.start.startsWith(prefix)) {
    return `${apiKey.start}…`;
  }

  return `${prefix}…`;
};

const formatApiKeyMeta = (apiKey: OrganizationApiKey) =>
  `Expires ${formatApiKeyDate(apiKey.expiresAt)}, last used ${formatApiKeyDate(apiKey.lastRequest)}`;

const remainingExpiresInSeconds = (expiresAt: Date | string | null) => {
  if (!expiresAt) return null;

  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;

  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
};

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied API key to clipboard.");
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

const CreatedApiKeyReveal = ({
  createdKey,
  onClose,
  title,
}: {
  createdKey: string;
  onClose: () => void;
  title: string;
}) => (
  <>
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>
        The full key is shown once. Store it before closing this dialog.
      </DialogDescription>
    </DialogHeader>

    <DialogBody className="space-y-3">
      <button
        className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-xs break-all text-foreground outline-none squircle hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => void copyText(createdKey)}
        type="button"
      >
        {createdKey}
      </button>
      <p className="text-sm text-muted-foreground">Click the key to copy it.</p>
    </DialogBody>

    <DialogFooter>
      <Button onClick={onClose} size="sm">
        Done
      </Button>
    </DialogFooter>
  </>
);

const CreateApiKeyDialog = ({ organizationId }: { organizationId: string }) => {
  const [open, setOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: async (input: {
      expiresIn: number | null;
      name: string;
      organizationId: string;
    }) => {
      const response = await authClient.apiKey.create({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        expiresIn: input.expiresIn,
        name: input.name,
        organizationId: input.organizationId,
        prefix: DEFAULT_API_KEY_PREFIX,
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Could not create API key.");
      }

      if (!response.data?.key) {
        throw new Error("Could not read the created API key.");
      }

      return response.data;
    },
    mutationKey: ["organization-api-keys", organizationId, "create"],
    onSuccess: async (data) => {
      setCreatedKey(data.key);
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
    },
  });
  const form = useForm({
    defaultValues: {
      expiration: "one_month" as ExpirationValue,
      name: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const expiration = expirationOptions.find((option) => option.value === value.expiration);

      try {
        await createMutation.mutateAsync({
          expiresIn: expiration?.seconds ?? null,
          name: value.name.trim(),
          organizationId,
        });
      } catch (mutationError) {
        setSubmitError(
          (mutationError as { message?: string })?.message ?? "Could not create API key.",
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        expiration: z.enum(expirationOptions.map((option) => option.value)),
        name: z.string().trim().min(1, "Name is required.").max(64, "Name is too long."),
      }),
    },
  });
  const resetDialog = () => {
    setCreatedKey(null);
    setSubmitError(null);
    form.reset({
      expiration: "one_month",
      name: "",
    });
  };

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
        Create
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetDialog();
        }}
        open={open}
      >
        <DialogContent className="w-[min(92vw,34rem)]">
          {createdKey ? (
            <CreatedApiKeyReveal
              createdKey={createdKey}
              onClose={() => {
                setOpen(false);
                resetDialog();
              }}
              title="API key created"
            />
          ) : (
            <form
              action={async () => {
                await form.handleSubmit();
              }}
            >
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  The full key is shown once. Store it before closing this dialog.
                </DialogDescription>
              </DialogHeader>

              <DialogBody className="space-y-4">
                <form.Field name="name">
                  {(field) => (
                    <TextField>
                      <FieldLabel>Name</FieldLabel>
                      <TextFieldInput
                        aria-invalid={field.state.meta.errors.length > 0}
                        name={field.name}
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="Production"
                        value={field.state.value}
                      />
                      {field.state.meta.errors.map((error) => (
                        <p className="text-sm text-destructive" key={error?.message}>
                          {error?.message}
                        </p>
                      ))}
                    </TextField>
                  )}
                </form.Field>

                <form.Field name="expiration">
                  {(field) => (
                    <TextField>
                      <FieldLabel>Expiration</FieldLabel>
                      <Select
                        items={expirationOptions.map(({ label, value }) => ({ label, value }))}
                        name={field.name}
                        onValueChange={(next) => {
                          setSubmitError(null);
                          field.handleChange(next as ExpirationValue);
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger
                          aria-invalid={field.state.meta.errors.length > 0}
                          onBlur={() => field.handleBlur()}
                        >
                          <SelectValue className="text-left" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectScrollUpArrow />
                          <SelectList>
                            {expirationOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectList>
                          <SelectScrollDownArrow />
                        </SelectContent>
                      </Select>
                      {field.state.meta.errors.map((error) => (
                        <p className="text-sm text-destructive" key={error?.message}>
                          {error?.message}
                        </p>
                      ))}
                    </TextField>
                  )}
                </form.Field>

                {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              </DialogBody>

              <DialogFooter>
                <DialogCloseButton disabled={createMutation.isPending}>Cancel</DialogCloseButton>
                <Button disabled={createMutation.isPending} size="sm" type="submit">
                  {createMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
                  )}
                  Create
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const ResetApiKeyDialog = ({
  apiKey,
  organizationId,
}: {
  apiKey: OrganizationApiKey;
  organizationId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const resetMutation = useMutation({
    mutationFn: async () => {
      const createResponse = await authClient.apiKey.create({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        expiresIn: remainingExpiresInSeconds(apiKey.expiresAt),
        name: apiKey.name?.trim() || "API key",
        organizationId,
        prefix: apiKey.prefix?.trim() || DEFAULT_API_KEY_PREFIX,
      });

      if (createResponse.error) {
        throw new Error(createResponse.error.message ?? "Could not create the replacement key.");
      }

      if (!createResponse.data?.key) {
        throw new Error("Could not read the replacement API key.");
      }

      const deleteResponse = await authClient.apiKey.delete({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        keyId: apiKey.id,
      });

      if (deleteResponse.error) {
        throw new Error(
          deleteResponse.error.message ??
            "Created a new key, but could not remove the previous one.",
        );
      }

      return createResponse.data;
    },
    mutationKey: ["organization-api-keys", organizationId, apiKey.id, "reset"],
    onSuccess: (data) => {
      setCreatedKey(data.key);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
      toast.error((error as { message?: string })?.message ?? "Could not reset API key.");
    },
  });
  const closeDialog = () => {
    const shouldRefresh = createdKey !== null;
    setOpen(false);
    setCreatedKey(null);
    if (shouldRefresh) {
      void queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
    }
  };

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }
        closeDialog();
      }}
      open={open}
    >
      <IconButtonTooltip label="Reset key">
        <Button
          aria-label="Reset key"
          disabled={resetMutation.isPending}
          onClick={() => setOpen(true)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            aria-hidden
            className={cn("size-4", resetMutation.isPending && "animate-spin")}
            icon={resetMutation.isPending ? Loading03Icon : Refresh01Icon}
          />
        </Button>
      </IconButtonTooltip>

      <AlertDialogContent>
        {createdKey ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>API key reset</AlertDialogTitle>
              <AlertDialogDescription>
                The previous key no longer works. Store the new key before closing.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogBody className="space-y-3">
              <button
                className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-xs break-all text-foreground outline-none squircle hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={() => void copyText(createdKey)}
                type="button"
              >
                {createdKey}
              </button>
              <p className="text-sm text-muted-foreground">Click the key to copy it.</p>
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button onClick={closeDialog} size="sm">
                Done
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset API key</AlertDialogTitle>
              <AlertDialogDescription>
                This replaces {apiKey.name ?? "this key"} with a new secret. The current key stops
                working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogBody>
              <p className="text-sm text-muted-foreground">
                Update any integrations that still use the old key.
              </p>
            </AlertDialogBody>

            <AlertDialogFooter>
              <AlertDialogCloseButton disabled={resetMutation.isPending}>
                Cancel
              </AlertDialogCloseButton>
              <Button
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
                size="sm"
              >
                {resetMutation.isPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Refresh01Icon} />
                )}
                Reset
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
};

const DeleteApiKeyDialog = ({
  apiKey,
  organizationId,
}: {
  apiKey: OrganizationApiKey;
  organizationId: string;
}) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.apiKey.delete({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        keyId: apiKey.id,
      });

      if (response.error) {
        throw new Error(response.error.message ?? "Could not remove API key.");
      }

      return response.data;
    },
    mutationKey: ["organization-api-keys", organizationId, apiKey.id, "delete"],
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
      toast.success("API key removed.");
    },
    onError: (error) => {
      toast.error((error as { message?: string })?.message ?? "Could not remove API key.");
    },
  });

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <IconButtonTooltip label="Remove key">
        <Button
          aria-label="Remove key"
          disabled={deleteMutation.isPending}
          onClick={() => setOpen(true)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            aria-hidden
            className={cn("size-4", deleteMutation.isPending ? "animate-spin" : "text-destructive")}
            icon={deleteMutation.isPending ? Loading03Icon : Delete02Icon}
          />
        </Button>
      </IconButtonTooltip>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove API key</AlertDialogTitle>
          <AlertDialogDescription>
            This immediately disables access for {apiKey.name ?? "this key"}.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogBody>
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
        </AlertDialogBody>

        <AlertDialogFooter>
          <AlertDialogCloseButton disabled={deleteMutation.isPending}>
            Cancel
          </AlertDialogCloseButton>
          <Button
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            size="sm"
            variant="destructive"
          >
            {deleteMutation.isPending ? (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            ) : (
              <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
            )}
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export const ApiKeysView = ({
  billingAccessUnknown,
  billingPending,
  canManageApiKeys,
  canUseOrganizationApiKeys,
  onBack,
  organization,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageApiKeys: boolean;
  canUseOrganizationApiKeys: boolean;
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const {
    data: apiKeysData,
    error: apiKeysError,
    isError: isApiKeysError,
    isPending: isApiKeysPending,
  } = useQuery(organizationApiKeysQueryOptions(organization.id));
  const apiKeys = (apiKeysData?.apiKeys ?? []) as OrganizationApiKey[];
  const manageApiKeysReason =
    (billingPending && "Loading billing access…") ||
    (billingAccessUnknown && "Could not load billing access.") ||
    (!canUseOrganizationApiKeys &&
      `Creating API keys requires ${BILLING_FEATURES.organizationApiKeys.requirementLabel} billing.`) ||
    (!canManageApiKeys && "Only admins and owners can create API keys.") ||
    null;

  return (
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>{organization.name}</SettingsBackButton>

      <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">API keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCount(apiKeys.length, "Key", "Keys")}
          </p>
        </div>

        {manageApiKeysReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />}
            label="Create"
            reason={manageApiKeysReason}
          />
        ) : (
          <CreateApiKeyDialog organizationId={organization.id} />
        )}
      </div>

      {isApiKeysPending ? (
        <div
          className={cn(
            "flex items-center gap-2 text-sm text-muted-foreground",
            settingsRowPaddingClass,
          )}
        >
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading API keys…
        </div>
      ) : isApiKeysError ? (
        <p className={cn("text-sm text-destructive", settingsRowPaddingClass)}>
          {apiKeysError?.message ?? "Could not load API keys."}
        </p>
      ) : apiKeys.length > 0 ? (
        <SettingsRows>
          {apiKeys.map((apiKey) => (
            <SettingsRow
              action={
                canManageApiKeys ? (
                  <div className="flex items-center gap-1">
                    <ResetApiKeyDialog apiKey={apiKey} organizationId={organization.id} />
                    <DeleteApiKeyDialog apiKey={apiKey} organizationId={organization.id} />
                  </div>
                ) : undefined
              }
              icon={<HugeiconsIcon aria-hidden icon={Key02Icon} />}
              key={apiKey.id}
              title={apiKey.name ?? "API key"}
            >
              <span className="font-mono">{formatApiKeyPreview(apiKey)}</span>
              {`. ${formatApiKeyMeta(apiKey)}`}
            </SettingsRow>
          ))}
        </SettingsRows>
      ) : (
        <p className={cn("text-center text-sm text-muted-foreground", settingsRowPaddingClass)}>
          No API keys.
        </p>
      )}
    </div>
  );
};
