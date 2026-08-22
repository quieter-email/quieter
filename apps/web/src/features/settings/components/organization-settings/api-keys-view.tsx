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

import { runDetached } from "#/features/settings/components/mailboxes-settings-shared";
import { authClient } from "#/lib/auth";
import { toastError } from "#/lib/error-toast";

import {
  SettingsBackButton,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  settingsSurfaceVariants,
} from "../settings-layout";
import {
  getOrganizationApiKeysQueryKey,
  organizationApiKeysQueryOptions,
} from "./api-keys";
import { formatCount } from "./domain";
import type { FullOrganization } from "./domain";
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

const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const DEFAULT_API_KEY_PREFIX = "quieter_";

const expirationOptions = [
  { label: "1 week", seconds: 60 * 60 * 24 * 7, value: "one_week" },
  { label: "1 month", seconds: 60 * 60 * 24 * 30, value: "one_month" },
  { label: "3 months", seconds: 60 * 60 * 24 * 90, value: "three_months" },
  { label: "6 months", seconds: 60 * 60 * 24 * 180, value: "six_months" },
  { label: "1 year", seconds: 60 * 60 * 24 * 365, value: "one_year" },
  { label: "3 years", seconds: 60 * 60 * 24 * 365 * 3, value: "three_years" },
  { label: "Never", seconds: null, value: "never" },
] as const;

type ExpirationValue = (typeof expirationOptions)[number]["value"];

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

const formatApiKeyDate = (value: Date | string | null) => {
  if (value === null) {
    return "Never";
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
};

const formatApiKeyPreview = (apiKey: OrganizationApiKey) => {
  const trimmedPrefix = apiKey.prefix?.trim() ?? "";
  const prefix = trimmedPrefix === "" ? DEFAULT_API_KEY_PREFIX : trimmedPrefix;
  const start = apiKey.start ?? "";

  if (start === "") {
    return `${prefix}…`;
  }
  if (start.startsWith(prefix)) {
    return `${start}…`;
  }

  return `${prefix}…`;
};

const formatApiKeyMeta = (apiKey: OrganizationApiKey) =>
  `Expires ${formatApiKeyDate(apiKey.expiresAt)}, last used ${formatApiKeyDate(apiKey.lastRequest)}`;

const IMMEDIATE_EXPIRES_IN_SECONDS = 1;

const remainingExpiresInSeconds = (expiresAt: Date | string | null) => {
  if (expiresAt === null) {
    return null;
  }

  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  return seconds > 0 ? seconds : IMMEDIATE_EXPIRES_IN_SECONDS;
};

const isExpirationValue = (value: string | null): value is ExpirationValue =>
  expirationOptions.some((option) => option.value === value);

const getManageApiKeysReason = ({
  billingAccessUnknown,
  billingPending,
  canManageApiKeys,
  canUseOrganizationApiKeys,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageApiKeys: boolean;
  canUseOrganizationApiKeys: boolean;
}) => {
  if (billingPending) {
    return "Loading billing access…";
  }
  if (billingAccessUnknown) {
    return "Could not load billing access.";
  }
  if (!canUseOrganizationApiKeys) {
    return `Creating API keys requires ${BILLING_FEATURES.organizationApiKeys.requirementLabel} billing.`;
  }
  if (!canManageApiKeys) {
    return "Only admins and owners can create API keys.";
  }
  return null;
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
        className="squircle w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-caption break-all text-fg hover:bg-secondary/50"
        onClick={() => {
          runDetached(async () => {
            await copyText(createdKey);
          });
        }}
        type="button"
      >
        {createdKey}
      </button>
      <p className="text-body text-muted-fg">Click the key to copy it.</p>
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
      const expiration = expirationOptions.find(
        (option) => option.value === value.expiration
      );

      try {
        await createMutation.mutateAsync({
          expiresIn: expiration?.seconds ?? null,
          name: value.name.trim(),
          organizationId,
        });
      } catch (mutationError: unknown) {
        setSubmitError(
          getMutationErrorMessage(mutationError, "Could not create API key.")
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        expiration: z.enum(expirationOptions.map((option) => option.value)),
        name: z
          .string()
          .trim()
          .min(1, "Name is required.")
          .max(64, "Name is too long."),
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
          if (!nextOpen) {
            resetDialog();
          }
        }}
        open={open}
      >
        <DialogContent className="w-[min(92vw,34rem)]">
          {createdKey === null ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                runDetached(async () => {
                  await form.handleSubmit();
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  The full key is shown once. Store it before closing this
                  dialog.
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
                        onBlur={() => {
                          field.handleBlur();
                        }}
                        onChange={(event) => {
                          setSubmitError(null);
                          field.handleChange(event.target.value);
                        }}
                        placeholder="Production"
                        value={field.state.value}
                      />
                      {field.state.meta.errors.map((error) => (
                        <p
                          className="text-body text-destructive"
                          key={error?.message}
                        >
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
                        items={expirationOptions.map(({ label, value }) => ({
                          label,
                          value,
                        }))}
                        name={field.name}
                        onValueChange={(next) => {
                          setSubmitError(null);
                          if (isExpirationValue(next)) {
                            field.handleChange(next);
                          }
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger
                          aria-invalid={field.state.meta.errors.length > 0}
                          onBlur={() => {
                            field.handleBlur();
                          }}
                        >
                          <SelectValue className="text-left" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectScrollUpArrow />
                          <SelectList>
                            {expirationOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectList>
                          <SelectScrollDownArrow />
                        </SelectContent>
                      </Select>
                      {field.state.meta.errors.map((error) => (
                        <p
                          className="text-body text-destructive"
                          key={error?.message}
                        >
                          {error?.message}
                        </p>
                      ))}
                    </TextField>
                  )}
                </form.Field>

                {submitError === null ? null : (
                  <p className="text-body text-destructive">{submitError}</p>
                )}
              </DialogBody>

              <DialogFooter>
                <DialogCloseButton disabled={createMutation.isPending}>
                  Cancel
                </DialogCloseButton>
                <Button
                  disabled={createMutation.isPending}
                  size="sm"
                  type="submit"
                >
                  {createMutation.isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4"
                      icon={Key02Icon}
                    />
                  )}
                  Create
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <CreatedApiKeyReveal
              createdKey={createdKey}
              onClose={() => {
                setOpen(false);
                resetDialog();
              }}
              title="API key created"
            />
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
        name: (() => {
          const trimmed = apiKey.name?.trim() ?? "";
          return trimmed === "" ? "API key" : trimmed;
        })(),
        organizationId,
        prefix: (() => {
          const trimmed = apiKey.prefix?.trim() ?? "";
          return trimmed === "" ? DEFAULT_API_KEY_PREFIX : trimmed;
        })(),
      });

      if (createResponse.error) {
        throw new Error(
          createResponse.error.message ??
            "Could not create the replacement key."
        );
      }

      if (!createResponse.data?.key) {
        throw new Error("Could not read the replacement API key.");
      }

      const deleteResponse = await authClient.apiKey.delete({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        keyId: apiKey.id,
      });

      return {
        cleanupFailed: Boolean(deleteResponse.error),
        key: createResponse.data.key,
      };
    },
    mutationKey: ["organization-api-keys", organizationId, apiKey.id, "reset"],
    onError: async (error: unknown) => {
      try {
        await queryClient.invalidateQueries({
          queryKey: getOrganizationApiKeysQueryKey(organizationId),
        });
      } catch {
        /* cache refresh failures are non-fatal */
      }
      toastError(error, {
        boundary: "organization-api-keys",
        fallback: "Could not reset API key.",
      });
    },
    onSuccess: (data) => {
      setCreatedKey(data.key);
      if (data.cleanupFailed) {
        toast.warning(
          "Created a new key, but could not remove the previous one. Delete the old key manually."
        );
      }
    },
  });
  const closeDialog = async () => {
    const shouldRefresh = createdKey !== null;
    setOpen(false);
    setCreatedKey(null);
    if (shouldRefresh) {
      try {
        await queryClient.invalidateQueries({
          queryKey: getOrganizationApiKeysQueryKey(organizationId),
        });
      } catch {
        /* cache refresh failures are non-fatal */
      }
    }
  };

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }
        runDetached(closeDialog);
      }}
      open={open}
    >
      <IconButtonTooltip label="Reset key">
        <Button
          aria-label="Reset key"
          disabled={resetMutation.isPending}
          onClick={() => {
            setOpen(true);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            aria-hidden
            className={cn("size-4", {
              "animate-spin": resetMutation.isPending,
            })}
            icon={resetMutation.isPending ? Loading03Icon : Refresh01Icon}
          />
        </Button>
      </IconButtonTooltip>

      <AlertDialogContent>
        {createdKey === null ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset API key</AlertDialogTitle>
              <AlertDialogDescription>
                This replaces {apiKey.name ?? "this key"} with a new secret. The
                current key stops working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogBody>
              <p className="text-body text-muted-fg">
                Update any integrations that still use the old key.
              </p>
            </AlertDialogBody>

            <AlertDialogFooter>
              <AlertDialogCloseButton disabled={resetMutation.isPending}>
                Cancel
              </AlertDialogCloseButton>
              <Button
                disabled={resetMutation.isPending}
                onClick={() => {
                  resetMutation.mutate();
                }}
                size="sm"
              >
                {resetMutation.isPending ? (
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4 animate-spin"
                    icon={Loading03Icon}
                  />
                ) : (
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Refresh01Icon}
                  />
                )}
                Reset
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>API key reset</AlertDialogTitle>
              <AlertDialogDescription>
                The previous key no longer works. Store the new key before
                closing.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogBody className="space-y-3">
              <button
                className="squircle w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left font-mono text-caption break-all text-fg hover:bg-secondary/50"
                onClick={() => {
                  runDetached(async () => {
                    await copyText(createdKey);
                  });
                }}
                type="button"
              >
                {createdKey}
              </button>
              <p className="text-body text-muted-fg">
                Click the key to copy it.
              </p>
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button
                onClick={() => {
                  runDetached(closeDialog);
                }}
                size="sm"
              >
                Done
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
    onError: (error) => {
      toastError(error, {
        boundary: "organization-api-keys",
        fallback: "Could not remove API key.",
      });
    },
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: getOrganizationApiKeysQueryKey(organizationId),
      });
      toast.success("API key removed.");
    },
  });

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <IconButtonTooltip label="Remove key">
        <Button
          aria-label="Remove key"
          disabled={deleteMutation.isPending}
          onClick={() => {
            setOpen(true);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            aria-hidden
            className={cn("size-4", {
              "animate-spin": deleteMutation.isPending,
              "text-destructive": !deleteMutation.isPending,
            })}
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
          <p className="text-body text-muted-fg">
            This action cannot be undone.
          </p>
        </AlertDialogBody>

        <AlertDialogFooter>
          <AlertDialogCloseButton disabled={deleteMutation.isPending}>
            Cancel
          </AlertDialogCloseButton>
          <Button
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
            size="sm"
            variant="destructive"
          >
            {deleteMutation.isPending ? (
              <HugeiconsIcon
                aria-hidden
                className="size-4 animate-spin"
                icon={Loading03Icon}
              />
            ) : (
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={Delete02Icon}
              />
            )}
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const ApiKeysListSection = ({
  apiKeys,
  canManageApiKeys,
  errorMessage,
  isError,
  isPending,
  organizationId,
}: {
  apiKeys: OrganizationApiKey[];
  canManageApiKeys: boolean;
  errorMessage: string | undefined;
  isError: boolean;
  isPending: boolean;
  organizationId: string;
}) => {
  if (isPending) {
    return <SettingsLoadingState label="Loading API keys" />;
  }
  if (isError) {
    return (
      <p
        className={cn(
          "text-body text-destructive",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        {errorMessage ?? "Could not load API keys."}
      </p>
    );
  }
  if (apiKeys.length === 0) {
    return (
      <p
        className={cn(
          "text-center text-body text-muted-fg",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        No API keys.
      </p>
    );
  }
  return (
    <SettingsRows>
      {apiKeys.map((apiKey) => (
        <SettingsRow
          action={
            canManageApiKeys ? (
              <div className="flex items-center gap-1">
                <ResetApiKeyDialog
                  apiKey={apiKey}
                  organizationId={organizationId}
                />
                <DeleteApiKeyDialog
                  apiKey={apiKey}
                  organizationId={organizationId}
                />
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
  const apiKeys = apiKeysData?.apiKeys ?? [];
  const manageApiKeysReason = getManageApiKeysReason({
    billingAccessUnknown,
    billingPending,
    canManageApiKeys,
    canUseOrganizationApiKeys,
  });

  return (
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>
        {organization.name}
      </SettingsBackButton>

      <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between">
        <div>
          <h1 className="text-body-lg font-semibold text-fg">API keys</h1>
          <p className="mt-1 text-body text-muted-fg">
            {formatCount(apiKeys.length, "Key", "Keys")}
          </p>
        </div>

        {manageApiKeysReason === null ? (
          <CreateApiKeyDialog organizationId={organization.id} />
        ) : (
          <MutedActionButton
            icon={
              <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
            }
            label="Create"
            reason={manageApiKeysReason}
          />
        )}
      </div>

      <ApiKeysListSection
        apiKeys={apiKeys}
        canManageApiKeys={canManageApiKeys}
        errorMessage={apiKeysError?.message}
        isError={isApiKeysError}
        isPending={isApiKeysPending}
        organizationId={organization.id}
      />
    </div>
  );
};
