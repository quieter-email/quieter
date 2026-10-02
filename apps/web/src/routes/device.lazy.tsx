import { createLazyFileRoute } from "@tanstack/react-router";

import { DeviceAuthorizationScreen } from "#/components/device-authorization-screen";

export const Route = createLazyFileRoute("/device")({
  component: DeviceAuthorizationScreen,
});
