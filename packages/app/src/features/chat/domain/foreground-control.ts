import { createStore } from "@tanstack/react-store";

export const createForegroundControl = () => {
  const state = createStore<{
    active: boolean;
    generation: number;
  }>({
    active: false,
    generation: 0,
  });
  let controller = new AbortController();
  return {
    begin() {
      controller.abort();
      controller = new AbortController();
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
      controller.abort();
      state.setState((current) => ({
        ...current,
        active: false,
        generation: current.generation + 1,
      }));
    },
    finish() {
      controller.abort();
      state.setState((current) => ({ ...current, active: false }));
    },
    isCurrent(generation: number) {
      const current = state.get();
      return current.active && current.generation === generation;
    },
    signal: () => controller.signal,
    state,
  };
};
