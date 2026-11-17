import type { CalendarAvailabilityResult } from "@quieter/calendar/availability";
import { z } from "zod";

export type BookingGuestSlot = Pick<
  CalendarAvailabilityResult["candidates"][number],
  "start" | "end"
>;

export type BookingGuestDetails = {
  name: string;
  email?: string;
  note?: string;
};

type BookingGuestFields = { name: string; email: string; note: string };

export type BookingGuestView =
  | {
      kind: "available";
      title: string;
      durationMinutes: number;
      timeZone: string;
      slots: readonly BookingGuestSlot[];
      next?: string;
    }
  | { kind: "unavailable" };

export type BookingGuestResult =
  | {
      kind: "confirmed";
      title: string;
      slot: BookingGuestSlot;
      timeZone: string;
    }
  | { kind: "pending" }
  | { kind: "unavailable" };

export type BookingGuestSource = {
  load: (input: {
    after?: string;
    signal: AbortSignal;
  }) => Promise<BookingGuestView>;
  submit: (input: {
    requestId: string;
    start: string;
    guest: BookingGuestDetails;
  }) => Promise<BookingGuestResult>;
  result: (input: {
    requestId: string;
    signal: AbortSignal;
  }) => Promise<BookingGuestResult>;
};

export type BookingGuestState =
  | { kind: "selecting"; guest: BookingGuestFields }
  | { kind: "reviewing"; guest: BookingGuestFields; slot: BookingGuestSlot }
  | { kind: "submitted"; requestId: string };

const receiptSchema = z
  .object({ requestId: z.uuid({ version: "v4" }) })
  .strict();

export const readBookingGuestReceipt = ({
  capabilityHash,
  storage,
}: {
  capabilityHash: string;
  storage: Pick<Storage, "getItem" | "removeItem"> | null;
}): string | null => {
  if (!/^[a-f0-9]{64}$/u.test(capabilityHash)) {
    throw new RangeError("Invalid booking receipt scope.");
  }
  if (!storage) {
    return null;
  }
  const key = `quieter-booking:${capabilityHash}`;
  try {
    const value = storage.getItem(key);
    if (value === null) {
      return null;
    }
    const receipt = receiptSchema.safeParse(JSON.parse(value));
    if (receipt.success) {
      return receipt.data.requestId;
    }
    storage.removeItem(key);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      return null;
    }
  }
  return null;
};

export const writeBookingGuestReceipt = ({
  capabilityHash,
  requestId,
  storage,
}: {
  capabilityHash: string;
  requestId: string | null;
  storage: Pick<Storage, "setItem" | "removeItem"> | null;
}): boolean => {
  if (!/^[a-f0-9]{64}$/u.test(capabilityHash)) {
    throw new RangeError("Invalid booking receipt scope.");
  }
  const receipt =
    requestId === null ? null : receiptSchema.parse({ requestId });
  if (!storage) {
    return false;
  }
  try {
    if (receipt === null) {
      storage.removeItem(`quieter-booking:${capabilityHash}`);
    } else {
      storage.setItem(
        `quieter-booking:${capabilityHash}`,
        JSON.stringify(receipt)
      );
    }
    return true;
  } catch {
    return false;
  }
};
