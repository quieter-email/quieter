"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { createStore, useSelector } from "@tanstack/react-store";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  readBookingGuestReceipt,
  writeBookingGuestReceipt,
} from "../domain/booking-guest";
import type {
  BookingGuestSlot,
  BookingGuestSource,
  BookingGuestState,
} from "../domain/booking-guest";
import { CalendarTimeZonePicker } from "./calendar-time-zone-picker";

type GuestSession = {
  client: QueryClient;
  queryId: string;
  storage: Storage | null;
  store: ReturnType<typeof createStore<BookingGuestState>>;
};

type BookingGuestScreenProps = {
  capabilityHash: string;
  source: BookingGuestSource;
};

const BookingGuestPanel = ({
  capabilityHash,
  session,
  source,
}: BookingGuestScreenProps & { session: GuestSession }) => {
  const state = useSelector(session.store, (current) => current);
  const [cursor, setCursor] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [problem, setProblem] = useState("");
  const mounted = useRef(true);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const view = useQuery({
    enabled: state.kind !== "submitted",
    queryFn: async ({ signal }) =>
      await source.load({ ...(cursor ? { after: cursor } : {}), signal }),
    queryKey: ["booking-guest", session.queryId, "view", cursor],
  });
  const submit = useMutation({
    mutationFn: async (request: Parameters<BookingGuestSource["submit"]>[0]) =>
      await source.submit(request),
    mutationKey: ["booking-guest", session.queryId, "submit"],
    onError: (error) => {
      if (mounted.current) {
        toastError(error, { boundary: "booking-guest-submit" });
      }
    },
    onSuccess: async () => {
      await session.client.invalidateQueries({
        queryKey: ["booking-guest", session.queryId, "view"],
      });
    },
  });
  const requestId = state.kind === "submitted" ? state.requestId : null;
  const submittedResult =
    submit.variables?.requestId === requestId ? submit.data : undefined;
  const receipt = useQuery({
    enabled:
      requestId !== null &&
      !submit.isPending &&
      (submittedResult === undefined || submittedResult.kind === "pending"),
    queryFn: async ({ signal }) => {
      if (!requestId) {
        throw new Error("A booking receipt is required.");
      }
      return await source.result({ requestId, signal });
    },
    queryKey: ["booking-guest", session.queryId, "result", requestId],
  });
  useEffect(() => {
    if (view.error) {
      toastError(view.error, { boundary: "booking-guest-view" });
    }
  }, [view.error]);
  useEffect(() => {
    if (receipt.error) {
      toastError(receipt.error, { boundary: "booking-guest-result" });
    }
  }, [receipt.error]);
  const date = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone }),
    [timeZone]
  );
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
        timeZoneName: "shortOffset",
      }),
    [timeZone]
  );
  const formatSlot = (slot: BookingGuestSlot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const firstDate = date.format(start);
    const lastDate = date.format(end);
    return `${firstDate}, ${time.format(start)} to ${
      firstDate === lastDate ? "" : `${lastDate}, `
    }${time.format(end)}`;
  };
  const result =
    submittedResult?.kind === "confirmed" ||
    submittedResult?.kind === "unavailable"
      ? submittedResult
      : (receipt.data ?? submittedResult);
  const page = view.data?.kind === "available" ? view.data : null;
  const chooseAnotherTime = () => {
    if (
      session.store.state.kind !== "submitted" ||
      (result?.kind !== "confirmed" && result?.kind !== "unavailable")
    ) {
      return;
    }
    writeBookingGuestReceipt({
      capabilityHash,
      requestId: null,
      storage: session.storage,
    });
    submit.reset();
    session.client.getMutationCache().clear();
    setCursor(null);
    setProblem("");
    session.store.setState(() => ({
      guest: { email: "", name: "", note: "" },
      kind: "selecting",
    }));
  };
  let content: ReactNode;
  if (state.kind === "submitted") {
    if (result?.kind === "confirmed") {
      content = (
        <>
          <Text as="h2" aria-live="polite" size="sm" weight="medium">
            Your time is booked
          </Text>
          <Text as="p" size="sm">
            {formatSlot(result.slot)}
          </Text>
          <Text as="p" size="caption" tone="muted">
            Confirmation is shown here. No invitation was sent.
          </Text>
          <ActionFooter>
            <Button onClick={chooseAnotherTime} type="button">
              Book another time
            </Button>
          </ActionFooter>
        </>
      );
    } else if (result?.kind === "unavailable") {
      content = (
        <>
          <Text as="p" aria-live="polite" size="sm">
            This booking could not be completed. Choose another time or contact
            the person who shared this link.
          </Text>
          <ActionFooter>
            <Button onClick={chooseAnotherTime} type="button">
              Choose another time
            </Button>
          </ActionFooter>
        </>
      );
    } else {
      content = (
        <>
          <Text as="p" aria-live="polite" size="sm">
            {submit.isPending
              ? "Confirming your booking…"
              : "Your booking has not been confirmed yet. Check its status before trying again."}
          </Text>
          <Text as="p" size="caption" tone="muted">
            Keep this page open while confirming your booking.
          </Text>
          <ActionFooter>
            <Button
              disabled={submit.isPending || receipt.isFetching}
              onClick={() => {
                void receipt.refetch();
              }}
              type="button"
            >
              {receipt.isFetching ? "Checking booking…" : "Check booking"}
            </Button>
          </ActionFooter>
        </>
      );
    }
  } else if (state.kind === "reviewing") {
    content = (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const current = session.store.state;
          if (
            current.kind !== "reviewing" ||
            view.isFetching ||
            view.isError ||
            page?.slots.some(
              (slot) =>
                slot.start === current.slot.start &&
                slot.end === current.slot.end
            ) !== true
          ) {
            return;
          }
          if (!current.guest.name.trim()) {
            setProblem("Enter your name before confirming.");
            return;
          }
          if (Date.parse(current.slot.start) <= Date.now()) {
            setProblem("This time has passed. Choose another time.");
            return;
          }
          const nextRequestId = crypto.randomUUID();
          session.store.setState(() => ({
            kind: "submitted",
            requestId: nextRequestId,
          }));
          writeBookingGuestReceipt({
            capabilityHash,
            requestId: nextRequestId,
            storage: session.storage,
          });
          submit.mutate({
            guest: {
              ...(current.guest.email.trim()
                ? { email: current.guest.email.trim() }
                : {}),
              name: current.guest.name.trim(),
              ...(current.guest.note.trim()
                ? { note: current.guest.note.trim() }
                : {}),
            },
            requestId: nextRequestId,
            start: current.slot.start,
          });
        }}
      >
        <Text as="p" size="sm">
          {formatSlot(state.slot)}
        </Text>
        <Text as="p" size="caption" tone="muted">
          This adds a private event to the owner’s calendar. You’ll see
          confirmation here; no invitation is sent.
        </Text>
        {(
          [
            { field: "name", label: "Your name", maxLength: 100 },
            { field: "email", label: "Email (optional)", maxLength: 254 },
          ] as const
        ).map(({ field, label, maxLength }) => (
          <Field key={field}>
            <FieldLabel htmlFor={`${id}-${field}`} size="caption">
              {label}
            </FieldLabel>
            <Input
              autoComplete={field}
              id={`${id}-${field}`}
              maxLength={maxLength}
              onChange={(event) => {
                const { value } = event.target;
                if (field === "name") {
                  setProblem("");
                }
                session.store.setState((current) =>
                  current.kind === "reviewing"
                    ? {
                        ...current,
                        guest: { ...current.guest, [field]: value },
                      }
                    : current
                );
              }}
              required={field === "name"}
              type={field === "email" ? "email" : "text"}
              value={state.guest[field]}
            />
          </Field>
        ))}
        <Field>
          <FieldLabel htmlFor={`${id}-note`} size="caption">
            Note (optional)
          </FieldLabel>
          <Textarea
            id={`${id}-note`}
            maxLength={1000}
            onChange={(event) => {
              const note = event.target.value;
              session.store.setState((current) =>
                current.kind === "reviewing"
                  ? { ...current, guest: { ...current.guest, note } }
                  : current
              );
            }}
            rows={3}
            value={state.guest.note}
          />
        </Field>
        {problem ||
        view.isError ||
        !page ||
        !page.slots.some(
          (slot) =>
            slot.start === state.slot.start && slot.end === state.slot.end
        ) ? (
          <Text as="p" role="alert" size="sm" tone="destructive">
            {problem ||
              "This time needs to be checked again. Choose another time."}
          </Text>
        ) : null}
        <ActionFooter>
          <Button
            onClick={() => {
              setProblem("");
              session.store.setState((current) =>
                current.kind === "reviewing"
                  ? { guest: current.guest, kind: "selecting" }
                  : current
              );
            }}
            type="button"
            variant="secondary"
          >
            Back
          </Button>
          <Button
            disabled={
              view.isFetching ||
              view.isError ||
              page?.slots.some(
                (slot) =>
                  slot.start === state.slot.start && slot.end === state.slot.end
              ) !== true
            }
            type="submit"
          >
            Confirm booking
          </Button>
        </ActionFooter>
      </form>
    );
  } else if (view.isPending) {
    content = (
      <Text as="p" aria-live="polite" size="sm">
        Checking available times…
      </Text>
    );
  } else if (view.isError) {
    content = (
      <>
        <Text as="p" role="alert" size="sm">
          Times could not be checked. Try again.
        </Text>
        <ActionFooter>
          <Button onClick={() => void view.refetch()} type="button">
            Retry
          </Button>
        </ActionFooter>
      </>
    );
  } else if (page) {
    content = (
      <>
        <Text as="p" size="sm">
          Choose a {page.durationMinutes}-minute time. Availability is checked
          again when you confirm.
        </Text>
        <div className="grid gap-2">
          {page.slots.map((slot) => (
            <Button
              disabled={view.isFetching}
              key={slot.start}
              onClick={() => {
                session.store.setState((current) =>
                  current.kind === "selecting"
                    ? { ...current, kind: "reviewing", slot }
                    : current
                );
              }}
              size="auto"
              type="button"
              variant="secondary"
            >
              {formatSlot(slot)}
            </Button>
          ))}
        </div>
        {page.slots.length === 0 ? (
          <Text as="p" aria-live="polite" size="sm">
            No times are available in this range.
          </Text>
        ) : null}
        {cursor !== null || page.next !== undefined ? (
          <ActionFooter>
            {cursor === null ? null : (
              <Button
                disabled={view.isFetching}
                onClick={() => {
                  setCursor(null);
                }}
                type="button"
                variant={page.next === undefined ? undefined : "secondary"}
              >
                Earlier times
              </Button>
            )}
            {page.next === undefined ? null : (
              <Button
                disabled={view.isFetching}
                onClick={() => {
                  if (page.next !== undefined) {
                    setCursor(page.next);
                  }
                }}
                type="button"
              >
                Show later times
              </Button>
            )}
          </ActionFooter>
        ) : null}
      </>
    );
  } else {
    content = (
      <Text as="p" aria-live="polite" size="sm">
        This booking link is unavailable. Contact the person who shared it.
      </Text>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4 sm:p-6">
      <Text as="h1" size="title">
        {state.kind === "submitted" && result?.kind === "confirmed"
          ? result.title
          : (page?.title ?? "Book a time")}
      </Text>
      <Surface variant="section">
        <div className="flex flex-col gap-4">
          <CalendarTimeZonePicker
            aria-label="Display time zone"
            onValueChange={setTimeZone}
            value={timeZone}
          />
          <Text as="p" size="caption" tone="muted">
            Times are shown in {timeZone}.
          </Text>
          {state.kind !== "submitted" && view.isFetching && !view.isPending ? (
            <Text as="p" aria-live="polite" size="sm" tone="muted">
              Checking available times…
            </Text>
          ) : null}
          {content}
        </div>
      </Surface>
    </main>
  );
};

const BookingGuestSession = ({
  capabilityHash,
  source,
}: BookingGuestScreenProps) => {
  // oxlint-disable-next-line react/hook-use-state -- Private caches and receipt memory share this screen lifetime.
  const [session] = useState<GuestSession>(() => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    const requestId = readBookingGuestReceipt({ capabilityHash, storage });
    return {
      client: new QueryClient({
        defaultOptions: {
          mutations: { gcTime: 0, retry: false },
          queries: { gcTime: 0, retry: false, staleTime: 0 },
        },
      }),
      queryId: crypto.randomUUID(),
      storage,
      store: createStore<BookingGuestState>(
        requestId
          ? { kind: "submitted", requestId }
          : { guest: { email: "", name: "", note: "" }, kind: "selecting" }
      ),
    };
  });
  useEffect(
    () => () => {
      void session.client.cancelQueries();
      session.client.clear();
    },
    [session]
  );
  return (
    <QueryClientProvider client={session.client}>
      <BookingGuestPanel
        capabilityHash={capabilityHash}
        session={session}
        source={source}
      />
    </QueryClientProvider>
  );
};

export const BookingGuestScreen = (props: BookingGuestScreenProps) => (
  <ClientOnly>
    <BookingGuestSession key={props.capabilityHash} {...props} />
  </ClientOnly>
);
