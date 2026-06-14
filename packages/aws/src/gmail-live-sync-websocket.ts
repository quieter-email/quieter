import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { serverEnv } from "@quieter/env/server";
import { getGmailLiveSyncAccess } from "@quieter/orpc/gmail-live-sync";
import { verifyGmailLiveSyncToken } from "@quieter/orpc/gmail-live-sync-token";
import { Resource } from "sst";

const CONNECTION_TTL_SECONDS = 60 * 60 * 3;

type WebSocketEvent = {
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    connectionId?: string;
    routeKey?: string;
  };
};

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION,
  }),
);

const response = (statusCode: number) => ({
  body: "",
  statusCode,
});

const handleConnect = async (event: WebSocketEvent, connectionId: string) => {
  const token = event.queryStringParameters?.token;
  if (!token) {
    return response(401);
  }

  try {
    const payload = verifyGmailLiveSyncToken(token, Resource.GmailLiveSyncTokenSecret.value);
    const access = await getGmailLiveSyncAccess({
      mailboxId: payload.mailboxId,
      userId: payload.userId,
    });
    if (!access.hasAccess) {
      return response(403);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    await dynamo.send(
      new PutCommand({
        Item: {
          connectedAt: nowSeconds,
          connectionId,
          expiresAt: nowSeconds + CONNECTION_TTL_SECONDS,
          mailboxId: payload.mailboxId,
          userId: payload.userId,
        },
        TableName: Resource.GmailLiveSyncConnections.name,
      }),
    );
    return response(200);
  } catch (error) {
    console.warn(
      "Rejected Gmail live-sync connection.",
      error instanceof Error ? error.message : "Unknown error.",
    );
    return response(403);
  }
};

export const handler = async (event: WebSocketEvent) => {
  const connectionId = event.requestContext?.connectionId;
  const routeKey = event.requestContext?.routeKey;
  if (!connectionId || !routeKey) {
    return response(400);
  }

  if (routeKey === "$connect") {
    return await handleConnect(event, connectionId);
  }
  if (routeKey === "$disconnect") {
    await dynamo.send(
      new DeleteCommand({
        Key: { connectionId },
        TableName: Resource.GmailLiveSyncConnections.name,
      }),
    );
  }

  return response(200);
};
