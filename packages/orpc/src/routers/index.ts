import { authRouter } from "./auth";
import { chatRouter } from "./chat";
import { mailRouter } from "./mail";
import { mailDomainsRouter } from "./mail-domains";

export const appRouter = {
  auth: authRouter,
  chat: chatRouter,
  mail: mailRouter,
  mailDomains: mailDomainsRouter,
};

export type AppRouter = typeof appRouter;
