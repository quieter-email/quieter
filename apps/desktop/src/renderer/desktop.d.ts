import type {
  ElectronClientOptions,
  ExposedBridges,
} from "@better-auth/electron/client";

import type { DesktopBridge } from "../shared/bridge";

declare global {
  interface Window extends ExposedBridges<ElectronClientOptions> {
    quieterDesktop: DesktopBridge;
  }
}
