import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { serverEnv } from "@quieter/env/server";
import { Resource } from "sst";

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION,
  }),
);
const connections = new ApiGatewayManagementApiClient({
  endpoint: Resource.GmailLiveSyncApi.managementEndpoint,
});

const isGoneConnectionError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "$metadata" in error &&
  typeof error.$metadata === "object" &&
  error.$metadata !== null &&
  "httpStatusCode" in error.$metadata &&
  error.$metadata.httpStatusCode === 410;

const deleteConnection = async (connectionId: string) => {
  await dynamo.send(
    new DeleteCommand({
      Key: { connectionId },
      TableName: Resource.GmailLiveSyncConnections.name,
    }),
  );
};

export type GmailLiveSyncEventType = "mailbox-details-dirty" | "mailbox-dirty";

const notifyConnection = async (
  connectionId: string,
  mailboxId: string,
  type: GmailLiveSyncEventType,
) => {
  try {
    await connections.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify({ mailboxId, type })),
      }),
    );
  } catch (error) {
    if (isGoneConnectionError(error)) {
      await deleteConnection(connectionId);
      return;
    }

    console.error(
      `Could not notify Gmail live-sync connection ${connectionId}.`,
      error instanceof Error ? error.message : "Unknown error.",
    );
  }
};

export const notifyGmailLiveSyncConnections = async (
  mailboxId: string,
  type: GmailLiveSyncEventType = "mailbox-dirty",
) => {
  let exclusiveStartKey: QueryCommandOutput["LastEvaluatedKey"];

  do {
    const page = await dynamo.send(
      new QueryCommand({
        ExclusiveStartKey: exclusiveStartKey,
        ExpressionAttributeNames: {
          "#mailboxId": "mailboxId",
        },
        ExpressionAttributeValues: {
          ":mailboxId": mailboxId,
        },
        IndexName: "mailboxId",
        KeyConditionExpression: "#mailboxId = :mailboxId",
        ProjectionExpression: "connectionId",
        TableName: Resource.GmailLiveSyncConnections.name,
      }),
    );
    const connectionIds =
      page.Items?.flatMap((item) =>
        typeof item.connectionId === "string" ? [item.connectionId] : [],
      ) ?? [];

    await Promise.all(
      connectionIds.map((connectionId) => notifyConnection(connectionId, mailboxId, type)),
    );
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
};
