import { describe, expect, test } from "vite-plus/test";

import {
  settingsDestinationSearch,
  settingsTeamSection,
} from "./settings-destination";

describe("settings navigation", () => {
  test("keeps the selected team when opening personal settings and clears detail state", () => {
    expect(
      settingsDestinationSearch({ tab: "appearance" }, "acme")
    ).toMatchObject({
      domainId: "",
      mailboxId: "",
      organizationId: "acme",
      section: "",
      tab: "appearance",
    });
  });

  test("opens a search result in its exact team, mailbox, and section", () => {
    expect(
      settingsDestinationSearch(
        {
          mailboxId: "hello",
          organizationId: "studio",
          section: "signature",
          tab: "mailboxes",
        },
        "acme"
      )
    ).toMatchObject({
      mailboxId: "hello",
      organizationId: "studio",
      section: "signature",
    });
  });

  test("can explicitly open team management without retaining the selected team", () => {
    expect(
      settingsDestinationSearch(
        { organizationId: "", tab: "organization" },
        "acme"
      ).organizationId
    ).toBe("");
  });

  test("keeps related subsections under the same sidebar item", () => {
    expect(settingsTeamSection("divisions")).toBe("members");
    expect(settingsTeamSection("suppressions")).toBe("delivery");
    expect(settingsTeamSection("danger")).toBe("overview");
  });
});
