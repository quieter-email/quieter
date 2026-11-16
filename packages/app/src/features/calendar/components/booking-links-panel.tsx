"use client";

import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import { Text } from "@quieter/ui/text";
import {
  CancelledError,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useRef } from "react";
import { z } from "zod";

import { BookingScopeForm } from "./booking-scope-form";

type BookingLinksPage = RouterOutputs["calendar"]["bookingLinks"];
type BookingLink = BookingLinksPage["links"][number];
type BookingCursor = RouterInputs["calendar"]["bookingLinks"]["after"];
type BookingLinksPanelProps = { onClose: () => void; userId: string };
type BookingLinksState =
  | {
      kind: "list";
      revocation: { kind: "confirm" | "pending"; link: BookingLink } | null;
    }
  | { kind: "create"; pending: boolean }
  | {
      capability: string;
      copy: "idle" | "pending" | "copied";
      kind: "created";
      link: BookingLink;
    };

const sessionSnapshotSchema = z.object({
  data: z.object({
    session: z.object({ id: z.string() }),
    user: z.object({ id: z.string() }),
  }),
  error: z.null(),
  isPending: z.literal(false),
});
const actionErrorSchema = z.object({
  message: z.string(),
  status: z.number().int().min(400).max(499),
});
const statusPresentation = {
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "gray" },
  revoked: { label: "Revoked", tone: "gray" },
} satisfies Record<BookingLink["status"], { label: string; tone: PillTone }>;

const reportBookingLinkError = (error: unknown, boundary: string) => {
  const expected = actionErrorSchema.safeParse(error);
  toastError(
    expected.success
      ? expected.data
      : new Error("A booking link action could not be completed."),
    { boundary }
  );
};

const OwnerBookingLinksPanel = ({
  onClose,
  sessionId,
  userId,
}: BookingLinksPanelProps & { sessionId: string }) => {
  const client = useQueryClient();
  const store = useCreateStore<BookingLinksState>({
    kind: "list",
    revocation: null,
  });
  const state = useSelector(store, (current) => current);
  const lifetime = useRef({ active: true, generation: 0 });
  const isCurrent = useCallback(
    (generation = lifetime.current.generation) => {
      // The live auth atom rejects completions before React commits an account change.
      const snapshot: unknown = authClient.$store.atoms.session?.get();
      const current = sessionSnapshotSchema.safeParse(snapshot);
      return (
        lifetime.current.active &&
        lifetime.current.generation === generation &&
        current.success &&
        current.data.data.user.id === userId &&
        current.data.data.session.id === sessionId
      );
    },
    [sessionId, userId]
  );
  useEffect(() => {
    const { current } = lifetime;
    current.active = true;
    return () => {
      current.active = false;
      current.generation += 1;
      store.setState(() => ({ kind: "list", revocation: null }));
    };
  }, [store]);
  const queryKey = ["calendar", userId, "booking-links"];
  const links = useInfiniteQuery({
    gcTime: 0,
    getNextPageParam: (page: BookingLinksPage) => page.next,
    initialPageParam: undefined,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: BookingCursor;
      signal: AbortSignal;
    }) => {
      const { generation } = lifetime.current;
      if (!isCurrent(generation)) {
        throw new CancelledError({ silent: true });
      }
      const page = await rpc.calendar.bookingLinks(
        pageParam ? { after: pageParam } : {},
        { signal }
      );
      if (!isCurrent(generation)) {
        throw new CancelledError({ silent: true });
      }
      return page;
    },
    queryKey,
    retry: false,
  });
  useEffect(() => {
    if (links.error && isCurrent()) {
      reportBookingLinkError(links.error, "booking-links-list");
    }
  }, [isCurrent, links.error]);
  const close = () => {
    if (!isCurrent()) {
      return;
    }
    lifetime.current.generation += 1;
    store.setState(() => ({ kind: "list", revocation: null }));
    onClose();
  };
  const create = async (
    input: RouterInputs["calendar"]["createBookingLink"]
  ) => {
    const current = store.get();
    const { generation } = lifetime.current;
    if (
      !isCurrent(generation) ||
      current.kind !== "create" ||
      current.pending
    ) {
      return;
    }
    store.setState(() => ({ kind: "create", pending: true }));
    try {
      const created = await rpc.calendar.createBookingLink(input);
      if (!isCurrent(generation)) {
        return;
      }
      store.setState(() => ({
        capability: created.capability,
        copy: "idle",
        kind: "created",
        link: created.link,
      }));
      void client.invalidateQueries({ exact: true, queryKey });
    } catch (error) {
      if (isCurrent(generation)) {
        store.setState(() => ({ kind: "create", pending: false }));
        reportBookingLinkError(error, "booking-link-create");
      }
    }
  };
  const revoke = async () => {
    const current = store.get();
    const { generation } = lifetime.current;
    if (
      !isCurrent(generation) ||
      current.kind !== "list" ||
      current.revocation?.kind !== "confirm"
    ) {
      return;
    }
    const { link } = current.revocation;
    store.setState(() => ({
      kind: "list",
      revocation: { kind: "pending", link },
    }));
    try {
      const revoked = await rpc.calendar.revokeBookingLink({ linkId: link.id });
      if (!isCurrent(generation)) {
        return;
      }
      client.setQueryData<InfiniteData<BookingLinksPage>>(queryKey, (pages) =>
        pages
          ? {
              ...pages,
              pages: pages.pages.map((page) => ({
                ...page,
                links: page.links.map((item) =>
                  item.id === revoked.id ? revoked : item
                ),
              })),
            }
          : pages
      );
      store.setState(() => ({ kind: "list", revocation: null }));
      void client.invalidateQueries({ exact: true, queryKey });
    } catch (error) {
      if (isCurrent(generation)) {
        store.setState(() => ({
          kind: "list",
          revocation: { kind: "confirm", link },
        }));
        reportBookingLinkError(error, "booking-link-revoke");
      }
    }
  };
  const copy = async () => {
    const current = store.get();
    const { generation } = lifetime.current;
    if (
      !isCurrent(generation) ||
      current.kind !== "created" ||
      current.copy === "pending"
    ) {
      return;
    }
    store.setState(() => ({ ...current, copy: "pending" }));
    try {
      const url = new URL("/book", window.location.origin);
      url.hash = current.capability;
      await navigator.clipboard.writeText(url.toString());
      if (isCurrent(generation)) {
        store.setState(() => ({ ...current, copy: "copied" }));
      }
    } catch {
      if (isCurrent(generation)) {
        store.setState(() => ({ ...current, copy: "idle" }));
        toastError(new Error("The booking link could not be copied."), {
          boundary: "booking-link-copy",
        });
      }
    }
  };
  const revocation = state.kind === "list" ? state.revocation : null;
  const items = links.data?.pages.flatMap((page) => page.links) ?? [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {state.kind === "create" ? "Create a booking link" : "Booking links"}
        </DialogTitle>
      </DialogHeader>
      {state.kind === "create" ? (
        <BookingScopeForm
          onCancel={() => {
            if (isCurrent()) {
              store.setState(() => ({ kind: "list", revocation: null }));
            }
          }}
          onCreate={create}
          userId={userId}
        />
      ) : null}
      {state.kind === "created" ? (
        <>
          <DialogBody spacing="4">
            <Text as="p" size="sm">
              {state.link.title}
            </Text>
            <Text as="p" size="caption" tone="muted">
              Copy and save your link now. It cannot be shown again after you
              close this panel.
            </Text>
            <Text as="p" size="caption" tone="muted">
              Bookings create private calendar events. No invitation is sent.
            </Text>
            <Text aria-live="polite" as="p" size="caption" tone="muted">
              {state.copy === "copied"
                ? "Link copied."
                : "Only share this link with people you want to book a time."}
            </Text>
          </DialogBody>
          <DialogFooter>
            <Button
              disabled={state.copy === "pending"}
              onClick={() => {
                void copy();
              }}
              pending={state.copy === "pending"}
              pendingLabel="Copying"
              type="button"
              variant="secondary"
            >
              Copy booking link
            </Button>
            <Button onClick={close} type="button">
              Done
            </Button>
          </DialogFooter>
        </>
      ) : null}
      {state.kind === "list" ? (
        <>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
            <Text as="p" size="caption" tone="muted">
              Each link has its own public title, availability, and expiry.
              Revoking a link stops new bookings and keeps existing events.
            </Text>
            {links.isPending ? (
              <Text aria-live="polite" as="p" size="sm" tone="muted">
                Loading booking links…
              </Text>
            ) : null}
            {links.isError ? (
              <div className="space-y-2">
                <Text as="p" role="alert" size="sm">
                  Your booking links could not be loaded.
                </Text>
                <Button
                  disabled={links.isFetching}
                  onClick={() => {
                    if (isCurrent()) {
                      void links.refetch();
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {links.isSuccess && items.length === 0 ? (
              <Text as="p" size="sm" tone="muted">
                You have no booking links yet.
              </Text>
            ) : null}
            {items.length > 0 ? (
              <ul className="space-y-4">
                {items.map((link) => (
                  <li className="flex min-w-0 items-center gap-3" key={link.id}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Text as="p" size="sm" truncate>
                        {link.title}
                      </Text>
                      <Text as="p" size="caption" tone="muted">
                        Expires{" "}
                        {new Date(link.expiresAt).toLocaleString(undefined, {
                          timeZoneName: "short",
                        })}
                      </Text>
                      <Pill tone={statusPresentation[link.status].tone}>
                        {statusPresentation[link.status].label}
                      </Pill>
                    </div>
                    {link.status === "active" ? (
                      <Button
                        disabled={revocation !== null}
                        onClick={() => {
                          if (isCurrent()) {
                            store.setState(() => ({
                              kind: "list",
                              revocation: { kind: "confirm", link },
                            }));
                          }
                        }}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {links.hasNextPage ? (
              <Button
                className="w-full"
                disabled={links.isFetching}
                onClick={() => {
                  if (isCurrent()) {
                    void links.fetchNextPage({ cancelRefetch: false });
                  }
                }}
                pending={links.isFetchingNextPage}
                pendingLabel="Loading"
                type="button"
                variant="secondary"
              >
                Load more
              </Button>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button onClick={close} type="button" variant="secondary">
              Close
            </Button>
            <Button
              onClick={() => {
                if (isCurrent()) {
                  store.setState(() => ({ kind: "create", pending: false }));
                }
              }}
              type="button"
            >
              Create booking link
            </Button>
          </DialogFooter>
        </>
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && revocation?.kind === "confirm" && isCurrent()) {
            store.setState(() => ({ kind: "list", revocation: null }));
          }
        }}
        open={revocation !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke booking link?</AlertDialogTitle>
            <AlertDialogDescription>
              People with this link will no longer be able to book a time. A
              booking already being saved may still finish. Existing events stay
              on your calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={revocation?.kind === "pending"}
              onClick={() => {
                if (isCurrent()) {
                  store.setState(() => ({ kind: "list", revocation: null }));
                }
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={revocation?.kind === "pending"}
              onClick={() => {
                void revoke();
              }}
              pending={revocation?.kind === "pending"}
              pendingLabel="Revoking"
              type="button"
              variant="destructive"
            >
              Revoke link
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export const BookingLinksPanel = ({
  onClose,
  userId,
}: BookingLinksPanelProps) => {
  const session = authClient.useSession();
  if (session.isPending || session.error || session.data?.user.id !== userId) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Booking links</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {session.error ? (
            <Text as="p" role="alert" size="sm">
              Your account could not be checked. Retry to continue.
            </Text>
          ) : null}
          {session.isPending ? (
            <Text aria-live="polite" as="p" size="sm" tone="muted">
              Checking your current account…
            </Text>
          ) : null}
          {!session.isPending && !session.error ? (
            <Text as="p" size="sm" tone="muted">
              Your active account changed. Close this panel and open it again.
            </Text>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={onClose}
            type="button"
            variant={session.error ? "secondary" : "default"}
          >
            Close
          </Button>
          {session.error ? (
            <Button
              onClick={() => {
                void session.refetch({ query: { disableCookieCache: true } });
              }}
              type="button"
            >
              Retry
            </Button>
          ) : null}
        </DialogFooter>
      </>
    );
  }
  return (
    <OwnerBookingLinksPanel
      key={`${userId}:${session.data.session.id}`}
      onClose={onClose}
      sessionId={session.data.session.id}
      userId={userId}
    />
  );
};
