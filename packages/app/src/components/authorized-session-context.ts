import { createContext } from "react";

export const AuthorizedSessionContext = createContext<{
  sessionId: string | undefined;
  userId: string | undefined;
} | null>(null);
