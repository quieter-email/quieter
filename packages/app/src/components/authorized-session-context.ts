import { createContext } from "react";

export const AuthorizedSessionContext = createContext<
  | { kind: "authorized"; sessionId: string; userId: string }
  | { kind: "unavailable" }
>({ kind: "unavailable" });
