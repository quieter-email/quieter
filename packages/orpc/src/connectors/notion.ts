import { z } from "zod";

import { ConnectorHttpError, runAuthorizedConnector } from "./runtime";

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 512_000;
const MAX_TEXT_LENGTH = 2000;
const MAX_BLOCKS = 30;
const MAX_READ_BLOCKS = 20;
const MAX_READ_TEXT_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_SEARCH_RESULTS = 30;

const notionIdSchema = z.uuid();
const cursorSchema = z.uuid();
const textSchema = z.string().trim().min(1).max(MAX_TEXT_LENGTH);
const blockTypeSchema = z.enum([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "to_do",
]);
const writeBlockSchema = z.strictObject({
  checked: z.boolean().optional(),
  text: textSchema,
  type: blockTypeSchema,
});

const toolInputs = {
  notion_append_blocks: z.strictObject({
    blockId: notionIdSchema,
    blocks: z.array(writeBlockSchema).min(1).max(MAX_BLOCKS),
  }),
  notion_create_page: z.strictObject({
    blocks: z.array(writeBlockSchema).max(MAX_BLOCKS).optional(),
    parentPageId: notionIdSchema,
    title: textSchema,
  }),
  notion_get_page: z.strictObject({ pageId: notionIdSchema }),
  notion_list_block_children: z.strictObject({
    blockId: notionIdSchema,
    cursor: cursorSchema.optional(),
  }),
  notion_search: z.strictObject({
    cursor: cursorSchema.optional(),
    kind: z.enum(["page", "data_source"]).optional(),
    query: z.string().trim().max(200).optional(),
  }),
} as const;

const uuidProperty = { format: "uuid", type: "string" } as const;
const textProperty = {
  maxLength: MAX_TEXT_LENGTH,
  minLength: 1,
  type: "string",
} as const;
const blockProperties = {
  checked: { type: "boolean" },
  text: textProperty,
  type: { enum: blockTypeSchema.options, type: "string" },
} as const;
const blocksProperty = {
  items: {
    additionalProperties: false,
    properties: blockProperties,
    required: ["type", "text"],
    type: "object",
  },
  maxItems: MAX_BLOCKS,
  minItems: 1,
  type: "array",
} as const;

export const NOTION_TOOLS = [
  {
    description:
      "Search the connected Notion workspace for pages or data sources by title. Leave query empty to browse accessible items. Results are paged and include IDs for follow-up reads or an explicitly chosen page parent.",
    effect: "read",
    inputSchema: {
      additionalProperties: false,
      properties: {
        cursor: uuidProperty,
        kind: { enum: ["page", "data_source"], type: "string" },
        query: { maxLength: 200, type: "string" },
      },
      type: "object",
    },
    name: "notion_search",
  },
  {
    description:
      "Read one accessible Notion page and its first 20 top-level content blocks. Use notion_list_block_children for more blocks or nested blocks.",
    effect: "read",
    inputSchema: {
      additionalProperties: false,
      properties: { pageId: uuidProperty },
      required: ["pageId"],
      type: "object",
    },
    name: "notion_get_page",
  },
  {
    description:
      "Read up to 20 direct children of a page or block. Follow nextCursor for the next page or use a returned block ID to inspect nested content.",
    effect: "read",
    inputSchema: {
      additionalProperties: false,
      properties: { blockId: uuidProperty, cursor: uuidProperty },
      required: ["blockId"],
      type: "object",
    },
    name: "notion_list_block_children",
  },
  {
    description:
      "Create a page below an explicitly selected existing page. Provide its exact parentPageId, title, and optional first-level text blocks. This changes the connected Notion workspace.",
    effect: "write",
    inputSchema: {
      additionalProperties: false,
      properties: {
        blocks: { ...blocksProperty, minItems: 0 },
        parentPageId: uuidProperty,
        title: textProperty,
      },
      required: ["parentPageId", "title"],
      type: "object",
    },
    name: "notion_create_page",
  },
  {
    description:
      "Append text blocks to an explicitly selected page or block by exact blockId. This changes the connected Notion workspace.",
    effect: "write",
    inputSchema: {
      additionalProperties: false,
      properties: { blockId: uuidProperty, blocks: blocksProperty },
      required: ["blockId", "blocks"],
      type: "object",
    },
    name: "notion_append_blocks",
  },
] as const;

export type NotionToolName = (typeof NOTION_TOOLS)[number]["name"];

const richTextSchema = z.looseObject({ plain_text: z.string().optional() });
const blockSchema = z.looseObject({
  has_children: z.boolean().optional(),
  id: notionIdSchema,
  type: z.string(),
});
const pageSchema = z.looseObject({
  id: notionIdSchema,
  last_edited_time: z.string().optional(),
  object: z.literal("page"),
  properties: z.record(z.string(), z.unknown()).optional(),
  url: z.string().optional(),
});
const searchResultSchema = z.looseObject({
  id: notionIdSchema,
  last_edited_time: z.string().optional(),
  object: z.enum(["page", "data_source"]),
  properties: z.record(z.string(), z.unknown()).optional(),
  title: z.array(richTextSchema).optional(),
  url: z.string().optional(),
});
const listSchema = z.looseObject({
  next_cursor: z.string().nullable(),
  results: z.array(z.unknown()),
});

const titleFromProperties = (
  properties: Record<string, unknown> | undefined
) => {
  if (!properties) {
    return "";
  }
  for (const property of Object.values(properties)) {
    if (typeof property !== "object" || property === null) {
      continue;
    }
    const parsed = z
      .looseObject({
        title: z.array(richTextSchema),
        type: z.literal("title"),
      })
      .safeParse(property);
    if (parsed.success) {
      return parsed.data.title
        .map((item) => item.plain_text ?? "")
        .join("")
        .slice(0, MAX_TITLE_LENGTH);
    }
  }
  return "";
};

const toBlockSummary = (value: unknown) => {
  const parsed = blockSchema.parse(value);
  const content =
    typeof value === "object" && value !== null
      ? (Reflect.get(value, parsed.type) as unknown)
      : undefined;
  const contentParsed = z
    .looseObject({
      checked: z.boolean().optional(),
      rich_text: z.array(richTextSchema).optional(),
      title: z.string().optional(),
    })
    .safeParse(content);
  return {
    hasChildren: parsed.has_children ?? false,
    id: parsed.id,
    text: (contentParsed.success
      ? (contentParsed.data.rich_text
          ?.map((item) => item.plain_text ?? "")
          .join("") ??
        contentParsed.data.title ??
        "")
      : ""
    ).slice(0, MAX_READ_TEXT_LENGTH),
    type: parsed.type,
    ...(contentParsed.success && contentParsed.data.checked !== undefined
      ? { checked: contentParsed.data.checked }
      : {}),
  };
};

const toWriteBlock = (block: z.infer<typeof writeBlockSchema>) => ({
  object: "block" as const,
  type: block.type,
  [block.type]: {
    rich_text: [{ text: { content: block.text }, type: "text" }],
    ...(block.type === "to_do" ? { checked: block.checked ?? false } : {}),
  },
});

const notionRequest = async (input: {
  accessToken: string;
  path: string;
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
}): Promise<unknown> => {
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
  if (input.signal) {
    signals.push(input.signal);
  }
  const response = await fetch(`${NOTION_API_URL}${input.path}`, {
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Notion-Version": NOTION_VERSION,
      ...(input.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    method: input.method,
    signal: AbortSignal.any(signals),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ConnectorHttpError(
      `Notion could not complete this request (HTTP ${response.status}).`,
      response.status
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Notion returned an empty response.");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(
        "Notion returned too much content. Open a smaller page or block."
      );
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined)) as unknown;
};

const listBlocks = async (
  accessToken: string,
  blockId: string,
  cursor?: string,
  signal?: AbortSignal
) => {
  const query = new URLSearchParams({ page_size: String(MAX_READ_BLOCKS) });
  if (cursor) {
    query.set("start_cursor", cursor);
  }
  const list = listSchema.parse(
    await notionRequest({
      accessToken,
      method: "GET",
      path: `/blocks/${blockId}/children?${query}`,
      signal,
    })
  );
  return {
    blocks: list.results.slice(0, MAX_READ_BLOCKS).map(toBlockSummary),
    nextCursor: list.next_cursor,
  };
};

export const callNotionTool = async (input: {
  userId: string;
  connectionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  signal?: AbortSignal;
}) => {
  const tool = NOTION_TOOLS.find(
    (candidate) => candidate.name === input.toolName
  );
  if (!tool) {
    throw new Error("Unknown Notion tool.");
  }
  if (!input.connectionId) {
    throw new Error("Select a Notion connection first.");
  }
  return await runAuthorizedConnector(
    {
      connectionId: input.connectionId,
      mutates: tool.effect === "write",
      provider: "notion",
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, signal) => {
      switch (input.toolName) {
        case "notion_search": {
          const args = toolInputs.notion_search.parse(input.arguments);
          const body = {
            page_size: MAX_SEARCH_RESULTS,
            ...(args.query ? { query: args.query } : {}),
            ...(args.kind
              ? { filter: { property: "object", value: args.kind } }
              : {}),
            ...(args.cursor ? { start_cursor: args.cursor } : {}),
            sort: { direction: "descending", timestamp: "last_edited_time" },
          };
          const list = listSchema.parse(
            await notionRequest({
              accessToken,
              body,
              method: "POST",
              path: "/search",
              signal,
            })
          );
          return {
            nextCursor: list.next_cursor,
            results: list.results.slice(0, MAX_SEARCH_RESULTS).map((item) => {
              const result = searchResultSchema.parse(item);
              return {
                id: result.id,
                kind: result.object,
                lastEditedTime: result.last_edited_time,
                title:
                  (result.object === "data_source"
                    ? result.title
                        ?.map((text) => text.plain_text ?? "")
                        .join("")
                    : titleFromProperties(result.properties)
                  )?.slice(0, MAX_TITLE_LENGTH) ?? "",
                url: result.url,
              };
            }),
          };
        }
        case "notion_get_page": {
          const args = toolInputs.notion_get_page.parse(input.arguments);
          const page = pageSchema.parse(
            await notionRequest({
              accessToken,
              method: "GET",
              path: `/pages/${args.pageId}`,
              signal,
            })
          );
          return {
            id: page.id,
            lastEditedTime: page.last_edited_time,
            title: titleFromProperties(page.properties),
            url: page.url,
            ...(await listBlocks(accessToken, args.pageId, undefined, signal)),
          };
        }
        case "notion_list_block_children": {
          const args = toolInputs.notion_list_block_children.parse(
            input.arguments
          );
          return await listBlocks(
            accessToken,
            args.blockId,
            args.cursor,
            signal
          );
        }
        case "notion_create_page": {
          const args = toolInputs.notion_create_page.parse(input.arguments);
          const page = pageSchema.parse(
            await notionRequest({
              accessToken,
              body: {
                parent: { page_id: args.parentPageId, type: "page_id" },
                properties: {
                  title: {
                    title: [{ text: { content: args.title }, type: "text" }],
                    type: "title",
                  },
                },
                ...(args.blocks !== undefined && args.blocks.length > 0
                  ? { children: args.blocks.map(toWriteBlock) }
                  : {}),
              },
              method: "POST",
              path: "/pages",
              signal,
            })
          );
          return { id: page.id, title: args.title, url: page.url };
        }
        case "notion_append_blocks": {
          const args = toolInputs.notion_append_blocks.parse(input.arguments);
          const list = listSchema.parse(
            await notionRequest({
              accessToken,
              body: { children: args.blocks.map(toWriteBlock) },
              method: "PATCH",
              path: `/blocks/${args.blockId}/children`,
              signal,
            })
          );
          return {
            appendedBlockIds: list.results.map(
              (item) => blockSchema.parse(item).id
            ),
            parentBlockId: args.blockId,
          };
        }
        default: {
          throw new Error("Unknown Notion tool.");
        }
      }
    }
  );
};
