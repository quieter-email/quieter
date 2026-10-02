import { deviceAuthorization } from "better-auth/plugins/device-authorization";

export const desktopDeviceAuthorization = deviceAuthorization({
  expiresIn: "5m",
  validateClient: (clientId) => clientId === "quieter-desktop",
  verificationUri: "/device",
});
