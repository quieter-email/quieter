"use client";

import type { Passkey as AuthPasskey } from "@better-auth/passkey";
import {
  Delete02Icon,
  Edit01Icon,
  Key02Icon,
  Logout03Icon,
} from "@hugeicons/core-free-icons";
import { setDemoModeEnabled } from "@quieter/app/features/settings/domain/demo-mode-setting";
import { setManagedDemoModeEnabled } from "@quieter/app/features/settings/domain/managed-demo-mode-setting";
import { authClient } from "@quieter/app/lib/auth";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  clearPreviewPersonaCookie,
  setPreviewPersona,
} from "@quieter/app/lib/preview-personas";
import { queryPersister } from "@quieter/app/lib/query-persister";
import { appRuntime, openExternalUrl } from "@quieter/app/runtime";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { SpinnerIcon } from "@quieter/ui/spinner-icon";
import { Text } from "@quieter/ui/text";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import {
  SettingsCard,
  SettingsFieldRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "./settings-layout";

const getMutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

type SettingsUser = {
  email: string;
  name: string;
};

type AccountSettingsPanelProps = {
  initialUser: SettingsUser;
};

const passkeyDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

const formatPasskeyDate = (value: AuthPasskey["createdAt"]) => {
  if (value === undefined || value === null) {
    return "Recently added";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently added";
  }

  return passkeyDateFormatter.format(date);
};

const getPasskeyLabel = (passkey: AuthPasskey) => {
  const trimmedName = passkey.name?.trim() ?? "";
  return trimmedName === "" ? passkey.deviceType : trimmedName;
};

const renderPasskeyList = (
  isPasskeysPending: boolean,
  passkeys: AuthPasskey[],
  removingPasskeyId: string | null,
  onRemovePasskey: (passkeyId: string) => void
) => {
  if (isPasskeysPending) {
    return (
      <p
        className={cn(
          settingsSurfaceVariants({ variant: "padding" }),
          settingsSurfaceVariants({ variant: "value" })
        )}
      >
        Loading passkeys…
      </p>
    );
  }

  if (passkeys.length === 0) {
    return (
      <p
        className={cn(
          settingsSurfaceVariants({ variant: "padding" }),
          settingsSurfaceVariants({ variant: "value" })
        )}
      >
        No passkeys.
      </p>
    );
  }

  return passkeys.map((passkey) => (
    <SettingsFieldRow
      key={passkey.id}
      label={getPasskeyLabel(passkey)}
      value={formatPasskeyDate(passkey.createdAt)}
      action={
        <Button
          disabled={removingPasskeyId === passkey.id}
          onClick={() => {
            onRemovePasskey(passkey.id);
          }}
          size="sm"
          variant="destructive"
        >
          {removingPasskeyId === passkey.id ? (
            <SpinnerIcon />
          ) : (
            <Icon aria-hidden icon={Delete02Icon} />
          )}
          Remove
        </Button>
      }
    />
  ));
};

const AccountNameSettings = ({
  currentName,
  handleSessionRefresh,
}: {
  currentName: string;
  handleSessionRefresh: () => Promise<unknown>;
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const updateUserMutation = useMutation({
    mutationFn: async (input: { name: string }) => {
      const response: unknown = await authClient.$fetch("/update-user", {
        body: input,
        method: "POST",
        throw: false,
      });
      if (
        typeof response === "object" &&
        response !== null &&
        "error" in response &&
        response.error !== null &&
        response.error !== undefined
      ) {
        const authError = response.error;
        const message =
          typeof authError === "object" &&
          authError !== null &&
          "message" in authError &&
          typeof authError.message === "string"
            ? authError.message
            : "Could not update name.";
        throw new Error(message);
      }
      return response;
    },
    mutationKey: ["auth", "update-user"],
    onSuccess: async () => {
      await handleSessionRefresh();
      await queryClient.invalidateQueries();
    },
  });
  const form = useForm({
    defaultValues: {
      name: currentName,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        await updateUserMutation.mutateAsync({ name: value.name.trim() });
        setSubmitError(null);
        form.reset({ name: value.name.trim() });
      } catch (mutationError) {
        setSubmitError(
          getMutationErrorMessage(mutationError, "Could not update name.")
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        name: z.string().trim().min(1, "Name cannot be empty."),
      }),
    },
  });

  return (
    <div className="w-full min-w-0 @md:w-72">
      <form
        className={settingsSurfaceVariants({ variant: "form" })}
        action={async () => {
          await form.handleSubmit();
        }}
      >
        <div className="space-y-3">
          <form.Field name="name">
            {(field) => (
              <TextField>
                <TextFieldInput
                  aria-label="Name"
                  aria-invalid={field.state.meta.errors.length > 0}
                  name={field.name}
                  onBlur={() => {
                    field.handleBlur();
                  }}
                  onChange={(event) => {
                    setSubmitError(null);
                    field.handleChange(event.target.value);
                  }}
                  value={field.state.value}
                />
                {field.state.meta.errors.map((error) => (
                  <Text key={error?.message} tone="destructive">
                    {error?.message}
                  </Text>
                ))}
              </TextField>
            )}
          </form.Field>

          {submitError === null ? null : (
            <Text tone="destructive">{submitError}</Text>
          )}
        </div>

        <div>
          <Button
            aria-label="Save name"
            disabled={updateUserMutation.isPending}
            type="submit"
          >
            {updateUserMutation.isPending ? (
              <SpinnerIcon />
            ) : (
              <Icon aria-hidden icon={Edit01Icon} />
            )}
            Save
          </Button>
        </div>
      </form>
    </div>
  );
};

const AccountEmailSettings = ({ currentEmail }: { currentEmail: string }) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const changeEmailMutation = useMutation({
    mutationFn: async (input: { callbackURL: string; newEmail: string }) => {
      const response = await authClient.changeEmail(input);
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not start email change."
        );
      }
      return response;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const form = useForm({
    defaultValues: {
      email: currentEmail,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        await changeEmailMutation.mutateAsync({
          callbackURL: "/settings?tab=account",
          newEmail: value.email.trim().toLowerCase(),
        });
      } catch (mutationError) {
        setSubmitError(
          getMutationErrorMessage(
            mutationError,
            "Could not start email change."
          )
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        email: z
          .string()
          .trim()
          .min(1, "Email is required.")
          .refine(
            (value) => z.email().safeParse(value).success,
            "Enter a valid email."
          )
          .refine(
            (value) =>
              new RegExp(
                `^(?!${currentEmail.trim().replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$).+$`,
                "iu"
              ).test(value),
            "Enter a different email."
          ),
      }),
    },
  });

  return (
    <div className="w-full min-w-0 @md:w-72">
      <form
        className={settingsSurfaceVariants({ variant: "form" })}
        action={async () => {
          await form.handleSubmit();
        }}
      >
        <div className="space-y-3">
          <form.Field name="email">
            {(field) => (
              <TextField>
                <TextFieldInput
                  aria-label="Email"
                  aria-invalid={field.state.meta.errors.length > 0}
                  autoCapitalize="none"
                  autoCorrect="off"
                  name={field.name}
                  onBlur={() => {
                    field.handleBlur();
                  }}
                  onChange={(event) => {
                    setSubmitError(null);
                    field.handleChange(event.target.value);
                  }}
                  type="email"
                  value={field.state.value}
                />
                {field.state.meta.errors.map((error) => (
                  <Text key={error?.message} tone="destructive">
                    {error?.message}
                  </Text>
                ))}
              </TextField>
            )}
          </form.Field>

          {submitError === null ? null : (
            <Text tone="destructive">{submitError}</Text>
          )}
        </div>

        <div>
          <Button
            aria-label="Change email"
            disabled={changeEmailMutation.isPending}
            type="submit"
          >
            {changeEmailMutation.isPending ? (
              <SpinnerIcon />
            ) : (
              <Icon aria-hidden icon={Edit01Icon} />
            )}
            Save
          </Button>
        </div>
      </form>
      {changeEmailMutation.isSuccess && (
        <output className="mt-2 block text-caption text-muted-fg">
          Check your email to confirm the change.
        </output>
      )}
    </div>
  );
};

const PasskeySettings = ({
  isPasskeysPending,
  passkeys,
}: {
  isPasskeysPending: boolean;
  passkeys: AuthPasskey[];
}) => {
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(
    null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const addPasskeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const trimmedName = name.trim();
      const response = await authClient.passkey.addPasskey({
        name: trimmedName === "" ? undefined : trimmedName,
      });
      if (
        typeof response === "object" &&
        response !== null &&
        "error" in response &&
        response.error !== null &&
        response.error !== undefined
      ) {
        const authError = response.error;
        const message =
          typeof authError === "object" &&
          authError !== null &&
          "message" in authError &&
          typeof authError.message === "string"
            ? authError.message
            : "Could not create a passkey.";
        throw new Error(message);
      }
      return response;
    },
    mutationKey: ["auth", "passkeys", "add"],
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const deletePasskeyMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      const response = await authClient.$fetch("/passkey/delete-passkey", {
        body: input,
        method: "POST",
        throw: false,
      });

      if (
        typeof response === "object" &&
        response !== null &&
        "error" in response &&
        response.error !== null &&
        response.error !== undefined
      ) {
        const errorMessage =
          typeof response.error === "object" &&
          response.error !== null &&
          "message" in response.error &&
          typeof response.error.message === "string"
            ? response.error.message
            : "Could not remove the passkey.";
        throw new Error(errorMessage);
      }
      return response;
    },
    mutationKey: ["auth", "passkeys", "delete"],
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const supportsPasskeys =
    typeof window !== "undefined" &&
    window.PublicKeyCredential !== undefined &&
    window.isSecureContext !== undefined &&
    window.isSecureContext;
  const form = useForm({
    defaultValues: {
      label: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      if (!supportsPasskeys) {
        setSubmitError("Passkeys are not supported in this browser.");
        return;
      }

      try {
        await addPasskeyMutation.mutateAsync(value.label);
        form.reset({ label: "" });
      } catch (mutationError) {
        setSubmitError(
          getMutationErrorMessage(mutationError, "Could not create a passkey.")
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        label: z.string(),
      }),
    },
  });

  const handlePasskeyDelete = async (passkeyId: string) => {
    setSubmitError(null);
    try {
      setRemovingPasskeyId(passkeyId);
      await deletePasskeyMutation.mutateAsync({ id: passkeyId });
      setRemovingPasskeyId(null);
    } catch (mutationError) {
      setSubmitError(
        getMutationErrorMessage(mutationError, "Could not remove the passkey.")
      );
      setRemovingPasskeyId(null);
    }
  };

  const handleRemovePasskeyClick = (passkeyId: string) => {
    void handlePasskeyDelete(passkeyId);
  };

  return (
    <>
      <SettingsFieldRow
        label="Passkeys"
        value={null}
        action={
          <div className="w-full min-w-0 @md:w-72">
            <form
              className={settingsSurfaceVariants({ variant: "form" })}
              action={async () => {
                await form.handleSubmit();
              }}
            >
              <form.Field name="label">
                {(field) => (
                  <TextField>
                    <TextFieldInput
                      aria-label="Passkey label"
                      name={field.name}
                      onBlur={() => {
                        field.handleBlur();
                      }}
                      onChange={(event) => {
                        setSubmitError(null);
                        field.handleChange(event.target.value);
                      }}
                      placeholder="Passkey label"
                      value={field.state.value}
                    />
                  </TextField>
                )}
              </form.Field>

              <Button
                disabled={addPasskeyMutation.isPending || !supportsPasskeys}
                type="submit"
              >
                {addPasskeyMutation.isPending ? (
                  <SpinnerIcon />
                ) : (
                  <Icon aria-hidden icon={Key02Icon} />
                )}
                Add passkey
              </Button>
            </form>
          </div>
        }
      />
      {submitError === null ? null : (
        <div className={settingsSurfaceVariants({ variant: "padding" })}>
          <Text tone="destructive">{submitError}</Text>
        </div>
      )}
      {renderPasskeyList(
        isPasskeysPending,
        passkeys,
        removingPasskeyId,
        handleRemovePasskeyClick
      )}
    </>
  );
};

const DeleteAccountDialog = () => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.deleteUser({
        callbackURL: "/home",
      });
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not delete the account."
        );
      }
      return response;
    },
    mutationKey: ["auth", "delete-user"],
    onSuccess: async () => {
      try {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => {
            draftRecoveryJournal.setUser(undefined);
          }),
          Promise.resolve().then(async () => {
            queryClient.clear();
            await queryPersister.removeQueries();
          }),
        ]);
        const failures = results
          .filter((result) => result.status === "rejected")
          .map((result): unknown => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(failures, "Local account cleanup failed.");
        }
        await navigate({
          to: "/home",
        });
      } catch (error) {
        toastError(error, { boundary: "account-deletion-cleanup" });
        throw new Error(
          "Could not finish clearing local account data. Please try again.",
          { cause: error }
        );
      }
    },
  });
  const form = useForm({
    defaultValues: {
      confirmation: "",
    },
    onSubmit: async () => {
      setSubmitError(null);

      try {
        await deleteAccountMutation.mutateAsync();
      } catch (mutationError) {
        setSubmitError(
          getMutationErrorMessage(
            mutationError,
            "Could not delete the account."
          )
        );
      }
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        confirmation: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^delete my account$/u, 'Type "delete my account".'),
      }),
    },
  });
  const resetDialog = () => {
    setSubmitError(null);
    form.reset({ confirmation: "" });
  };

  return (
    <>
      <Button
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
        size="sm"
        variant="destructive"
      >
        <Icon aria-hidden icon={Delete02Icon} />
        Delete account
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
          </DialogHeader>

          <form
            action={async () => {
              await form.handleSubmit();
            }}
          >
            <DialogBody spacing="3">
              <p className="text-body text-muted-fg">
                Type{" "}
                <span className="font-medium text-fg">delete my account</span>
              </p>

              <form.Field name="confirmation">
                {(field) => (
                  <TextField>
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
                      placeholder="delete my account"
                      value={field.state.value}
                    />
                    {field.state.meta.errors.map((error) => (
                      <Text key={error?.message} tone="destructive">
                        {error?.message}
                      </Text>
                    ))}
                  </TextField>
                )}
              </form.Field>

              {submitError === null ? null : (
                <Text tone="destructive">{submitError}</Text>
              )}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={deleteAccountMutation.isPending}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={deleteAccountMutation.isPending}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {deleteAccountMutation.isPending ? (
                  <SpinnerIcon />
                ) : (
                  <Icon aria-hidden icon={Delete02Icon} />
                )}
                Delete
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const handleManagePasskeys = async () => {
  try {
    await openExternalUrl("/settings?tab=account");
  } catch (error) {
    toastError(error, { boundary: "account-passkeys" });
  }
};

export const AccountSettingsPanel = ({
  initialUser,
}: AccountSettingsPanelProps) => {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sessionState = authClient.useSession();
  const passkeysState = authClient.useListPasskeys();
  const sessionUser = sessionState.data?.user;
  const user = {
    email: sessionUser?.email ?? initialUser.email,
    name: sessionUser?.name ?? initialUser.name,
  };
  const passkeys = passkeysState.data ?? [];
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signOut();
      if (response.error) {
        throw new Error(response.error.message ?? "Could not sign out.");
      }
      return response;
    },
    mutationKey: ["auth", "sign-out"],
    onSuccess: async () => {
      setPreviewPersona(null);
      setDemoModeEnabled(false);
      setManagedDemoModeEnabled(false);
      try {
        await clearPreviewPersonaCookie();
      } catch {
        // Best-effort cleanup; sign-out teardown must continue.
      }
      queryClient.clear();
      await queryPersister.removeQueries();
      await navigate({
        to: "/home",
      });
    },
  });

  const handleSignOut = async () => {
    setSessionError(null);
    try {
      await signOutMutation.mutateAsync();
    } catch (mutationError) {
      setSessionError(
        getMutationErrorMessage(mutationError, "Could not sign out.")
      );
    }
  };

  const handleSignOutClick = () => {
    void handleSignOut();
  };

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsSection title="Profile">
        <SettingsCard>
          <SettingsFieldRow
            action={
              <AccountNameSettings
                currentName={user.name}
                handleSessionRefresh={sessionState.refetch}
              />
            }
            label="Name"
            value={null}
          />

          <SettingsFieldRow
            action={<AccountEmailSettings currentEmail={user.email} />}
            label="Email"
            value={null}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Security">
        <SettingsCard>
          {appRuntime.platform === "desktop" ? (
            <SettingsFieldRow
              action={
                <Button
                  onClick={() => {
                    void handleManagePasskeys();
                  }}
                  size="sm"
                  variant="outline"
                >
                  Manage in browser
                </Button>
              }
              label="Passkeys"
              value="Use your browser to manage passkeys."
            />
          ) : (
            <PasskeySettings
              isPasskeysPending={passkeysState.isPending}
              passkeys={passkeys}
            />
          )}

          <SettingsFieldRow
            action={
              <Button
                disabled={signOutMutation.isPending}
                onClick={handleSignOutClick}
                size="sm"
                variant="outline"
              >
                {signOutMutation.isPending ? (
                  <SpinnerIcon />
                ) : (
                  <Icon aria-hidden icon={Logout03Icon} />
                )}
                Sign out
              </Button>
            }
            label="Session"
            value="Current browser session"
          />
        </SettingsCard>
        {sessionError === null ? null : (
          <p className="px-1 text-body text-destructive">{sessionError}</p>
        )}
      </SettingsSection>

      <SettingsSection title="Delete account">
        <SettingsCard>
          <SettingsFieldRow
            action={<DeleteAccountDialog />}
            label="Delete account"
            value="Permanent"
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
};
