import type { APIEvent } from "@solidjs/start/server";
import { handleTrpcRequest } from "@quietr/trpc/server";

const endpoint = "/api/trpc";

const handler = ({ request }: APIEvent) => handleTrpcRequest(request, endpoint);

export const GET = handler;
export const POST = handler;
