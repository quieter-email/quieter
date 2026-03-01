import type { APIEvent } from "@solidjs/start/server";
import { auth } from "@quietr/auth";

const handler = async ({ request }: APIEvent) => await auth.handler(request);

export const GET = handler;
export const POST = handler;
