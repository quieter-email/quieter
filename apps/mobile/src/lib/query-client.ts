import { createAppQueryClient } from "@quieter/query";
import { focusManager, onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { AppState } from "react-native";

export const queryClient = createAppQueryClient();

focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (state) => {
    handleFocus(state === "active");
  });
  return () => {
    subscription.remove();
  };
});

onlineManager.setEventListener((setOnline) => {
  const subscription = Network.addNetworkStateListener((state) => {
    setOnline(state.isConnected === true);
  });
  return () => {
    subscription.remove();
  };
});
