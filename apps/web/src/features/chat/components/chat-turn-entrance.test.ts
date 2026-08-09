import { describe, expect, it } from "vite-plus/test";

import {
  createChatTurnEntranceState,
  trackChatTurnEntrances,
} from "./chat-turn-entrance";

describe("chat turn entrances", () => {
  it("seeds hydrated turns without animating them", () => {
    const state = createChatTurnEntranceState();

    expect(trackChatTurnEntrances(state, [], false)).toStrictEqual(new Set());
    expect(
      trackChatTurnEntrances(state, ["existing-user"], true)
    ).toStrictEqual(new Set());
    expect(state.newTurnIds).toStrictEqual(new Set());
  });

  it("enters each post-hydration turn once", () => {
    const state = createChatTurnEntranceState();
    trackChatTurnEntrances(state, ["existing-user"], true);

    expect(
      trackChatTurnEntrances(state, ["existing-user", "new-user"], true)
    ).toStrictEqual(new Set(["new-user"]));
    expect(
      trackChatTurnEntrances(state, ["existing-user", "new-user"], true)
    ).toStrictEqual(new Set());
    expect(state.newTurnIds).toStrictEqual(new Set(["new-user"]));
  });
});
