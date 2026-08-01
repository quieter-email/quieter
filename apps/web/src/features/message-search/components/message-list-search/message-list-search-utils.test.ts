import { describe, expect, test } from "vite-plus/test";
import { cycleSearchFilter } from "./message-list-search-utils";

describe("cycleSearchFilter", () => {
  test("changes an included filter to an excluded filter", () => {
    expect(cycleSearchFilter([{ type: "label", value: "Finance" }], 0)).toEqual([
      { negated: true, type: "label", value: "Finance" },
    ]);
  });

  test("removes an excluded filter", () => {
    expect(
      cycleSearchFilter(
        [
          { type: "is", value: "unread" },
          { negated: true, type: "label", value: "Finance" },
        ],
        1,
      ),
    ).toEqual([{ type: "is", value: "unread" }]);
  });

  test("keeps filters unchanged for an invalid index", () => {
    const filters = [{ type: "label", value: "Finance" }] as const;
    const result = cycleSearchFilter(filters, 1);

    expect(result).toEqual(filters);
    expect(result).not.toBe(filters);
  });
});
