import { describe, expect, test } from "bun:test";
import {
  parseStructuredSearchFilterToken,
  parseStructuredSearchQuery,
  serializeStructuredSearchFilterToken,
} from "./message-list-search-state";

describe("structured message search", () => {
  test("parses added field filters", () => {
    expect(parseStructuredSearchQuery("filename:payouts.csv cc:casey@example.com")).toEqual({
      filters: [
        { type: "filename", value: "payouts.csv" },
        { type: "cc", value: "casey@example.com" },
      ],
      text: "",
    });
  });

  test("parses underscore and fixed-value filters", () => {
    expect(
      parseStructuredSearchQuery("older_than:30d newer_than:1y has:attachment is:unread"),
    ).toEqual({
      filters: [
        { type: "older_than", value: "30d" },
        { type: "newer_than", value: "1y" },
        { type: "has", value: "attachment" },
        { type: "is", value: "unread" },
      ],
      text: "",
    });
  });

  test("rejects unsupported fixed-value filters", () => {
    expect(parseStructuredSearchFilterToken("has:drive")).toBeNull();
    expect(parseStructuredSearchFilterToken("is:starred")).toBeNull();
    expect(parseStructuredSearchFilterToken("has:")).toBeNull();
  });

  test("serializes quoted values", () => {
    expect(serializeStructuredSearchFilterToken({ type: "filename", value: "tax form.pdf" })).toBe(
      'filename:"tax form.pdf"',
    );
  });
});
