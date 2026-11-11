import { createStore } from "@tanstack/react-store";

export const createForegroundControl = () => {
  const state = createStore<{
    active: boolean;
    generation: number;
  }>({
    active: false,
    generation: 0,
  });
  return {
    begin() {
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
    finish() {
      state.setState((current) => ({ ...current, active: false }));
    },
    isCurrent(generation: number) {
      const current = state.get();
      return current.active && current.generation === generation;
    },
    state,
  };
};
