"use client";

import type { Passkey as AuthPasskey } from "@better-auth/passkey";
import type { ReactNode } from "react";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Edit01Icon,
  Key02Icon,
  Loading03Icon,
  Logout03Icon,
  Moon01Icon,
  Settings01Icon,
  Sun01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
  TextFieldInput,
  useColorMode,
} from "@quietr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { authClient, signOut } from "~/lib/auth";
import { settingsSearchParams, type SettingsTab } from "~/lib/search-params";

type SettingsUser = {
  email: string;
  emailVerified: boolean;
  image?: string | null;
  name: string;
};

type SettingsScreenProps = {
  initialTab: SettingsTab;
  from: string;
  initialUser: SettingsUser;
};

type PlaceholderPreview = {
  createdAt: number;
  email: string;
  token: string;
  type: "magic-link" | "verification";
  url: string;
};

const DELETE_CONFIRMATION = "delete my account";

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return fallback;
};

const unwrapAuthResult = <T,>(result: T, fallback: string) => {
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new Error(getErrorMessage(result.error, fallback));
  }

  return result;
};

const formatPasskeyDate = (value: AuthPasskey["createdAt"]) => {
  if (!value) return "Recently added";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently added";

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
};

const loadPreview = async (email: string) => {
  const previewResponse = await fetch(
    `/api/auth-email-preview?email=${encodeURIComponent(email)}`,
    {
      cache: "no-store",
    },
  );

  if (!previewResponse.ok) {
    return null;
  }

  return (await previewResponse.json()) as PlaceholderPreview;
};

const loadUserStatus = async (email: string) => {
  const statusResponse = await fetch(`/api/auth-user-status?email=${encodeURIComponent(email)}`, {
    cache: "no-store",
  });

  if (!statusResponse.ok) {
    throw new Error("Could not check that email.");
  }

  return (await statusResponse.json()) as {
    email: string;
    exists: boolean;
    hasGoogleAccount: boolean;
  };
};

type SettingsRowProps = {
  action: ReactNode;
  label: string;
  value: ReactNode;
};

const SettingsRow = ({ action, label, value }: SettingsRowProps) => (
  <div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 py-5 last:border-b-0 md:flex-row md:items-center">
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 text-sm text-muted-foreground">{value}</div>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);

export const SettingsScreen = ({ from, initialTab, initialUser }: SettingsScreenProps) => {
  const { colorMode, isMounted, setColorMode } = useColorMode();
  const sessionState = authClient.useSession();
  const passkeysState = authClient.useListPasskeys();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [{ from: queryFrom, tab }, setSettingsQuery] = useQueryStates(settingsSearchParams, {
    history: "replace",
    scroll: false,
  });
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editMailOpen, setEditMailOpen] = useState(false);
  const [editMailError, setEditMailError] = useState<string | null>(null);
  const [editMailPending, setEditMailPending] = useState(false);
  const [editMailPreview, setEditMailPreview] = useState<PlaceholderPreview | null>(null);
  const [editMailValue, setEditMailValue] = useState(initialUser.email);
  const [editNameError, setEditNameError] = useState<string | null>(null);
  const [editNamePending, setEditNamePending] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [nextName, setNextName] = useState(initialUser.name);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [passkeyModalOpen, setPasskeyModalOpen] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const activeTab = tab || initialTab;
  const backTarget = queryFrom || from;
  const isDarkMode = isMounted && colorMode === "dark";
  const sessionUser = sessionState.data?.user;
  const user = useMemo<SettingsUser>(
    () => ({
      email: sessionUser?.email ?? initialUser.email,
      emailVerified: sessionUser?.emailVerified ?? initialUser.emailVerified,
      image: sessionUser?.image ?? initialUser.image,
      name: sessionUser?.name ?? initialUser.name,
    }),
    [initialUser, sessionUser],
  );
  const passkeys = passkeysState.data ?? [];
  const supportsPasskeys =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof window.isSecureContext !== "undefined" &&
    window.isSecureContext;

  useEffect(() => {
    if (!editNameOpen) {
      setEditNameError(null);
      setNextName(user.name);
    }
  }, [editNameOpen, user.name]);

  useEffect(() => {
    if (!editMailOpen) {
      setEditMailError(null);
      setEditMailPreview(null);
      setEditMailValue(user.email);
    }
  }, [editMailOpen, user.email]);

  useEffect(() => {
    if (!deleteAccountOpen) {
      setDeleteConfirmation("");
      setDeleteError(null);
    }
  }, [deleteAccountOpen]);

  useEffect(() => {
    if (!passkeyModalOpen) {
      setPasskeyError(null);
      setPasskeyLabel("");
    }
  }, [passkeyModalOpen]);

  const setTab = (nextTab: SettingsTab) => {
    void setSettingsQuery({ tab: nextTab });
  };

  const handleSignOut = async () => {
    setSessionError(null);
    setIsSigningOut(true);

    try {
      await signOut();
      queryClient.clear();
      router.push("/home");
    } catch (error) {
      setSessionError(getErrorMessage(error, "Could not sign out."));
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleNameSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEditNameError(null);

    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      setEditNameError("Name cannot be empty.");
      return;
    }

    setEditNamePending(true);

    try {
      unwrapAuthResult(
        await authClient.updateUser({ name: trimmedName }),
        "Could not update name.",
      );
      await sessionState.refetch();
      setEditNameOpen(false);
    } catch (error) {
      setEditNameError(getErrorMessage(error, "Could not update name."));
    } finally {
      setEditNamePending(false);
    }
  };

  const handleMailSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEditMailError(null);
    setEditMailPreview(null);

    const nextEmail = editMailValue.trim().toLowerCase();
    if (nextEmail.length === 0) {
      setEditMailError("Email is required.");
      return;
    }

    if (nextEmail === user.email.toLowerCase()) {
      setEditMailError("Enter a different email.");
      return;
    }

    setEditMailPending(true);

    try {
      const status = await loadUserStatus(nextEmail);

      if (status.exists) {
        throw new Error("That email already has an account.");
      }

      unwrapAuthResult(
        await authClient.changeEmail({
          callbackURL: "/settings?tab=account",
          newEmail: nextEmail,
        }),
        "Could not start email change.",
      );
      setEditMailPreview(await loadPreview(nextEmail));
    } catch (error) {
      setEditMailError(getErrorMessage(error, "Could not start email change."));
    } finally {
      setEditMailPending(false);
    }
  };

  const handlePasskeyCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasskeyError(null);

    if (!supportsPasskeys) {
      setPasskeyError("Passkeys are not supported in this browser.");
      return;
    }

    setPasskeyPending(true);

    try {
      unwrapAuthResult(
        await authClient.passkey.addPasskey({
          authenticatorAttachment: "platform",
          name: passkeyLabel.trim() || undefined,
        }),
        "Could not create a passkey.",
      );
      setPasskeyLabel("");
    } catch (error) {
      setPasskeyError(getErrorMessage(error, "Could not create a passkey."));
    } finally {
      setPasskeyPending(false);
    }
  };

  const handlePasskeyDelete = async (passkeyId: string) => {
    setPasskeyError(null);
    setRemovingPasskeyId(passkeyId);

    try {
      const response = await authClient.$fetch("/passkey/delete-passkey", {
        body: { id: passkeyId },
        method: "POST",
        throw: false,
      });

      unwrapAuthResult(response, "Could not remove the passkey.");
    } catch (error) {
      setPasskeyError(getErrorMessage(error, "Could not remove the passkey."));
    } finally {
      setRemovingPasskeyId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation.trim().toLowerCase() !== DELETE_CONFIRMATION) {
      setDeleteError(`Type "${DELETE_CONFIRMATION}".`);
      return;
    }

    setDeleteError(null);
    setIsDeletingAccount(true);

    try {
      unwrapAuthResult(
        await authClient.deleteUser({
          callbackURL: "/home",
        }),
        "Could not delete the account.",
      );
      queryClient.clear();
      router.push("/home");
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Could not delete the account."));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="mx-auto grid h-dvh max-w-4xl grid-cols-[auto_1fr] py-20">
      <aside className="mr-20 border-r pr-20">
        <button
          className="inline-flex h-8 w-fit shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-transparent px-3 text-xs leading-none font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none hover:border-border/80 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => router.push(backTarget)}
          type="button"
        >
          <HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
          <span>Back</span>
        </button>

        <div className="flex flex-col gap-2 pt-12">
          <Button
            className="flex w-fit items-center gap-2"
            onClick={() => setTab("general")}
            size="sm"
            variant={activeTab === "general" ? "default" : "ghost"}
          >
            <HugeiconsIcon className="size-4" icon={Settings01Icon} />
            General
          </Button>

          <Button
            className="flex w-fit items-center gap-2"
            onClick={() => setTab("account")}
            size="sm"
            variant={activeTab === "account" ? "default" : "ghost"}
          >
            <HugeiconsIcon className="size-4" icon={UserIcon} />
            Account
          </Button>
        </div>
      </aside>

      <main className="h-full overflow-y-auto pt-20 pr-6">
        {activeTab === "general" ? (
          <Button
            onClick={() => setColorMode(isDarkMode ? "light" : "dark")}
            size="sm"
            variant="default"
          >
            {!isMounted ? (
              <>
                <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
                Theme
              </>
            ) : isDarkMode ? (
              <>
                <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Sun01Icon} />
                Light mode
              </>
            ) : (
              <>
                <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
                Dark mode
              </>
            )}
          </Button>
        ) : null}

        {activeTab === "account" ? (
          <div>
            <div className="pb-8">
              <h1 className="text-2xl font-medium tracking-tight text-foreground">{user.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
              {sessionError ? (
                <p className="mt-4 text-sm text-destructive">{sessionError}</p>
              ) : null}
            </div>

            <div>
              <SettingsRow
                action={
                  <Button onClick={() => setEditNameOpen(true)} size="sm" variant="outline">
                    <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                    Edit name
                  </Button>
                }
                label="Name"
                value={user.name}
              />

              <SettingsRow
                action={
                  <Button onClick={() => setEditMailOpen(true)} size="sm" variant="outline">
                    <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                    Edit mail
                  </Button>
                }
                label="Mail"
                value={user.email}
              />

              <SettingsRow
                action={
                  <Button onClick={() => setPasskeyModalOpen(true)} size="sm" variant="outline">
                    <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
                    Edit passkeys
                  </Button>
                }
                label="Passkeys"
                value={passkeys.length === 1 ? "1 passkey" : `${passkeys.length} passkeys`}
              />

              <SettingsRow
                action={
                  <Button
                    disabled={isSigningOut}
                    onClick={() => void handleSignOut()}
                    size="sm"
                    variant="outline"
                  >
                    {isSigningOut ? (
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4 animate-spin"
                        icon={Loading03Icon}
                      />
                    ) : (
                      <HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />
                    )}
                    Sign out
                  </Button>
                }
                label="Session"
                value="Current browser session"
              />

              <SettingsRow
                action={
                  <Button
                    onClick={() => setDeleteAccountOpen(true)}
                    size="sm"
                    variant="destructive"
                  >
                    <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                    Delete account
                  </Button>
                }
                label="Delete account"
                value="Permanent"
              />
            </div>
          </div>
        ) : null}
      </main>

      <Dialog onOpenChange={setEditNameOpen} open={editNameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit name</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleNameSave}>
            <DialogBody className="space-y-3">
              <TextField>
                <TextFieldInput
                  autoFocus
                  onChange={(event) => setNextName(event.target.value)}
                  value={nextName}
                />
              </TextField>
              {editNameError ? <p className="text-sm text-destructive">{editNameError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={editNamePending}>Cancel</DialogCloseButton>
              <Button disabled={editNamePending} size="sm" type="submit">
                {editNamePending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setEditMailOpen} open={editMailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit mail</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleMailSave}>
            <DialogBody className="space-y-3">
              <TextField>
                <TextFieldInput
                  autoFocus
                  onChange={(event) => setEditMailValue(event.target.value)}
                  type="email"
                  value={editMailValue}
                />
              </TextField>
              {editMailPreview ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">Placeholder verification link</p>
                  <a className="break-all underline" href={editMailPreview.url}>
                    {editMailPreview.url}
                  </a>
                </div>
              ) : null}
              {editMailError ? <p className="text-sm text-destructive">{editMailError}</p> : null}
            </DialogBody>

            <DialogFooter>
              <DialogCloseButton disabled={editMailPending}>Cancel</DialogCloseButton>
              <Button disabled={editMailPending} size="sm" type="submit">
                {editMailPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setPasskeyModalOpen} open={passkeyModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit passkeys</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <form className="space-y-3" onSubmit={handlePasskeyCreate}>
              <TextField>
                <TextFieldInput
                  onChange={(event) => setPasskeyLabel(event.target.value)}
                  placeholder="Passkey label"
                  value={passkeyLabel}
                />
              </TextField>

              <Button disabled={passkeyPending || !supportsPasskeys} size="sm" type="submit">
                {passkeyPending ? (
                  <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
                ) : (
                  <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
                )}
                Add passkey
              </Button>
            </form>

            <div className="space-y-3">
              {passkeysState.isPending ? (
                <p className="text-sm text-muted-foreground">Loading passkeys...</p>
              ) : passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No passkeys.</p>
              ) : (
                passkeys.map((passkey) => (
                  <div className="flex items-center justify-between gap-4" key={passkey.id}>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {passkey.name?.trim() || passkey.deviceType}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatPasskeyDate(passkey.createdAt)}
                      </p>
                    </div>

                    <Button
                      disabled={removingPasskeyId === passkey.id}
                      onClick={() => void handlePasskeyDelete(passkey.id)}
                      size="sm"
                      variant="outline"
                    >
                      {removingPasskeyId === passkey.id ? (
                        <HugeiconsIcon
                          aria-hidden
                          className="size-4 animate-spin"
                          icon={Loading03Icon}
                        />
                      ) : (
                        <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                      )}
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>

            {passkeyError ? <p className="text-sm text-destructive">{passkeyError}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton>Close</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteAccountOpen} open={deleteAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{DELETE_CONFIRMATION}</span>
            </p>
            <TextField>
              <TextFieldInput
                autoFocus
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={DELETE_CONFIRMATION}
                value={deleteConfirmation}
              />
            </TextField>
            {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton disabled={isDeletingAccount}>Cancel</DialogCloseButton>
            <Button
              disabled={isDeletingAccount}
              onClick={() => void handleDeleteAccount()}
              size="sm"
              variant="destructive"
            >
              {isDeletingAccount ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
