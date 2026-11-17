import { describe, expect, test } from "vite-plus/test";

import {
  readBookingGuestReceipt,
  writeBookingGuestReceipt,
} from "./booking-guest";

describe("guest booking receipt privacy", () => {
  test("recovers one opaque receipt only within its capability scope", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const capabilityHash = "a".repeat(64);
    const requestId = crypto.randomUUID();
    expect(
      writeBookingGuestReceipt({ capabilityHash, requestId, storage })
    ).toBeTruthy();
    expect(readBookingGuestReceipt({ capabilityHash, storage })).toBe(
      requestId
    );
    expect(
      readBookingGuestReceipt({ capabilityHash: "b".repeat(64), storage })
    ).toBeNull();
    writeBookingGuestReceipt({ capabilityHash, requestId: null, storage });
    expect(readBookingGuestReceipt({ capabilityHash, storage })).toBeNull();
  });

  test.each([
    "not JSON",
    JSON.stringify({ requestId: "not-a-request" }),
    JSON.stringify({
      email: "guest@example.test",
      requestId: "11111111-1111-4111-8111-111111111111",
    }),
  ])("discards malformed or private recovery payloads", (stored) => {
    let value: string | null = stored;
    const storage = {
      getItem: () => value,
      removeItem: () => {
        value = null;
      },
    };
    expect(
      readBookingGuestReceipt({ capabilityHash: "a".repeat(64), storage })
    ).toBeNull();
    expect(value).toBeNull();
  });

  test("never uses a raw capability as a storage scope", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const capabilityHash = "a".repeat(43);
    expect(() =>
      writeBookingGuestReceipt({
        capabilityHash,
        requestId: crypto.randomUUID(),
        storage,
      })
    ).toThrow(RangeError);
    expect(() => readBookingGuestReceipt({ capabilityHash, storage })).toThrow(
      RangeError
    );
    expect(values.size).toBe(0);
  });

  test("unavailable storage leaves confirmation recovery optional", () => {
    const storage = {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
      removeItem: () => {
        throw new Error("Storage unavailable");
      },
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    };
    const capabilityHash = "a".repeat(64);
    expect(readBookingGuestReceipt({ capabilityHash, storage })).toBeNull();
    expect(
      writeBookingGuestReceipt({
        capabilityHash,
        requestId: crypto.randomUUID(),
        storage,
      })
    ).toBeFalsy();
  });
});
