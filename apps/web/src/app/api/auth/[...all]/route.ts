import { auth } from "@quietr/auth";
import { assertDatabaseConfigured } from "@quietr/database";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

export const DELETE = async (...args: Parameters<typeof handlers.DELETE>) => {
  assertDatabaseConfigured();
  return await handlers.DELETE(...args);
};

export const GET = async (...args: Parameters<typeof handlers.GET>) => {
  assertDatabaseConfigured();
  return await handlers.GET(...args);
};

export const PATCH = async (...args: Parameters<typeof handlers.PATCH>) => {
  assertDatabaseConfigured();
  return await handlers.PATCH(...args);
};

export const POST = async (...args: Parameters<typeof handlers.POST>) => {
  assertDatabaseConfigured();
  return await handlers.POST(...args);
};

export const PUT = async (...args: Parameters<typeof handlers.PUT>) => {
  assertDatabaseConfigured();
  return await handlers.PUT(...args);
};
