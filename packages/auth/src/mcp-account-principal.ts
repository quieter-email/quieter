import { AsyncLocalStorage } from "node:async_hooks";

import type {
  GenericEndpointContext,
  HookEndpointContext,
  InternalAdapter,
} from "@better-auth/core";
import { withRequestDatabaseClient } from "@quieter/database/client";
import { APIError } from "better-auth/api";

import type { McpAccount } from "./mcp";

type AccountAuthInvocation = {
  nonce: string;
  path: string;
  principal: McpAccount;
};

const accountAuthInvocation = new AsyncLocalStorage<AccountAuthInvocation>();
const invocationHeader = "x-quieter-internal-mcp-invocation";

const getAccountAuthInvocation = (ctx: HookEndpointContext) => {
  const invocation = accountAuthInvocation.getStore();
  return invocation &&
    !ctx.request &&
    invocation.path === ctx.path &&
    ctx.headers?.get(invocationHeader) === invocation.nonce
    ? invocation
    : undefined;
};

export const loadMcpAccountUser = async (
  adapter: Pick<InternalAdapter, "findUserById">,
  id: string
) => {
  const user = await adapter.findUserById(id);
  if (!user) {
    throw new APIError("UNAUTHORIZED", { message: "Account is unavailable." });
  }
  return user;
};

export const applyMcpAccountPrincipal = async (ctx: GenericEndpointContext) => {
  const invocation = getAccountAuthInvocation(ctx);
  if (!invocation) {
    return;
  }
  const user = await loadMcpAccountUser(
    ctx.context.internalAdapter,
    invocation.principal.id
  );
  const now = new Date();
  // Better Auth checks permissions through its session context. This expired
  // placeholder has no corresponding credential or stored browser session.
  ctx.context.session = {
    session: {
      createdAt: now,
      expiresAt: new Date(0),
      id: invocation.nonce,
      token: `mcp-action:${invocation.nonce}`,
      updatedAt: now,
      userId: user.id,
    },
    user,
  };
};

// oxlint-disable-next-line require-await -- Better Auth requires async middleware.
export const clearMcpAccountCookies = async (ctx: HookEndpointContext) => {
  if (getAccountAuthInvocation(ctx)) {
    ctx.context.responseHeaders?.delete("set-cookie");
  }
};

export const runMcpAccountAuth = async <Result>(
  principal: McpAccount,
  endpoint: { path: string },
  invoke: (headers: Headers) => Promise<Result>
) => {
  const nonce = crypto.randomUUID();
  return await accountAuthInvocation.run(
    { nonce, path: endpoint.path, principal },
    async () =>
      await withRequestDatabaseClient(
        async () => await invoke(new Headers({ [invocationHeader]: nonce }))
      )
  );
};
