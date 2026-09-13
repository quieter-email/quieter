import { createStore } from "@tanstack/react-store";

export const createForegroundControl = () => {
  const state = createStore<{
    active: boolean;
    generation: number;
    policy: "ask" | "automatic";
  }>({
    active: false,
    generation: 0,
    policy: "ask",
  });
  let deadline = 0;
  let legs = 0;
  return {
    begin() {
      deadline = Date.now() + 120_000;
      legs = 0;
      state.setState((current) => ({
        ...current,
        active: true,
        generation: current.generation + 1,
      }));
      return state.get().generation;
    },
    cancel() {
      if (!state.get().active) {
        return;
      }
      state.setState((current) => ({
        ...current,
        active: false,
        generation: current.generation + 1,
      }));
    },
    claimLeg(generation: number) {
      if (!this.isCurrent(generation) || legs >= 12) {
        throw new Error(
          "This request has stopped. Send a follow-up to continue."
        );
      }
      legs += 1;
    },
    finish() {
      state.setState((current) => ({ ...current, active: false }));
    },
    isCurrent(generation: number) {
      const current = state.get();
      return (
        current.active &&
        current.generation === generation &&
        Date.now() < deadline
      );
    },
    state,
  };
};
