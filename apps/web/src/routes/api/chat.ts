import {
  chatParamsFromRequest,
  createChatResponse,
  toolDefinition,
  type ServerTool,
} from "@quieter/ai";
import { MAILBOX_LABELS, type MailboxCategory } from "@quieter/gmail";
import { createOrpcServerClient } from "@quieter/orpc/server-client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSessionUserForRequest } from "~/lib/auth.server";

const mailboxCategories = Object.keys(MAILBOX_LABELS) as MailboxCategory[];

const gmailSearchPrompt = `You are Quieter's email assistant. Answer normally when no mailbox data is needed. When the user asks about their email or wants to find messages, use the search_gmail tool.

The search_gmail query accepts free text and Gmail search operators. Use these operators when helpful: from:, to:, cc:, bcc:, subject:, after:, before:, older:, newer:, older_than:, newer_than:, OR, { }, AND, -, AROUND, label:, category:primary/social/promotions/updates/forums/reservations/purchases, has:attachment/youtube/drive/document/spreadsheet/presentation, list:, filename:, quoted exact phrases, parentheses, in:anywhere, in:archive, in:snoozed, is:muted, is:important/starred/unread/read, has:yellow-star/orange-star/red-star/purple-star/blue-star/green-star/red-bang/orange-guillemet/yellow-bang/green-check/blue-info/purple-question, deliveredto:, size:, larger:, smaller:, +term, rfc822msgid:, has:userlabels, has:nouserlabels, label:encryptedmail.`;

const gmailSearchToolDef = toolDefinition({
  name: "search_gmail",
  description:
    "Search the selected Gmail mailbox with Gmail search syntax and return matching message summaries.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(500).meta({
      description: "Gmail search query. Can be free text or use Gmail operators.",
    }),
    maxResults: z.number().int().min(1).max(10).default(5).meta({
      description: "Maximum number of message summaries to return.",
    }),
  }),
  outputSchema: z.object({
    category: z.enum(mailboxCategories),
    error: z.string().optional(),
    messages: z.array(
      z.object({
        date: z.string().optional(),
        from: z.string().optional(),
        id: z.string(),
        isUnread: z.boolean().optional(),
        labelIds: z.array(z.string()).optional(),
        snippet: z.string().optional(),
        subject: z.string().optional(),
        threadId: z.string(),
      }),
    ),
    query: z.string(),
    resultSizeEstimate: z.number().optional(),
  }),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUserForRequest(request);
        if (!user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let params: Awaited<ReturnType<typeof chatParamsFromRequest>>;

        try {
          params = await chatParamsFromRequest(request);
        } catch (error) {
          if (error instanceof Response) {
            return error;
          }

          return Response.json({ error: "Invalid chat request." }, { status: 400 });
        }

        const chatContext = parseChatContext(params.forwardedProps);

        try {
          return createChatResponse({
            messages: params.messages,
            systemPrompts: [gmailSearchPrompt],
            tools: [createGmailSearchTool(request, chatContext)],
          });
        } catch (error) {
          return Response.json(
            {
              error: error instanceof Error ? error.message : "Could not generate a chat response.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});

type ChatRequestBody = {
  category: MailboxCategory;
  mailboxId: string | null;
};

const createGmailSearchTool = (request: Request, body: ChatRequestBody): ServerTool =>
  gmailSearchToolDef.server(async ({ query, maxResults }) => {
    if (!body.mailboxId) {
      return {
        category: body.category,
        error: "No Gmail mailbox is selected.",
        messages: [],
        query,
      };
    }

    try {
      const rpc = createOrpcServerClient({ headers: request.headers });
      const result = await rpc.mail.listMessages({
        category: body.category,
        mailboxId: body.mailboxId,
        maxResults,
        query,
      });

      return {
        category: body.category,
        messages: result.messages.map((message) => ({
          date: message.date ?? message.internalDate,
          from: message.from,
          id: message.id,
          isUnread: message.isUnread,
          labelIds: message.labelIds,
          snippet: message.snippet,
          subject: message.subject,
          threadId: message.threadId,
        })),
        query,
        resultSizeEstimate: result.resultSizeEstimate,
      };
    } catch (error) {
      return {
        category: body.category,
        error: error instanceof Error ? error.message : "Gmail search failed.",
        messages: [],
        query,
      };
    }
  });

const parseChatContext = (forwardedProps: Record<string, unknown>): ChatRequestBody => {
  const category =
    typeof forwardedProps.category === "string" &&
    mailboxCategories.includes(forwardedProps.category as MailboxCategory)
      ? (forwardedProps.category as MailboxCategory)
      : "inbox";
  const mailboxId =
    typeof forwardedProps.mailboxId === "string" ? forwardedProps.mailboxId.trim() || null : null;

  return { category, mailboxId };
};
