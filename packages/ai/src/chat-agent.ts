import { MAILBOX_LABELS, type MailboxCategory } from "@quieter/gmail";
import { toolDefinition, type ServerTool } from "@tanstack/ai";
import { z } from "zod";

const mailboxCategories = Object.keys(MAILBOX_LABELS) as MailboxCategory[];

export const gmailSearchPrompt = `You are Quieter's email assistant. Answer normally when no mailbox data is needed. When the user asks about their email or wants to find messages, use the search_gmail tool.

The search_gmail query accepts free text and Gmail search operators. Use these operators when helpful: from:, to:, cc:, bcc:, subject:, after:, before:, older:, newer:, older_than:, newer_than:, OR, { }, AND, -, AROUND, label:, category:primary/social/promotions/updates/forums/reservations/purchases, has:attachment/youtube/drive/document/spreadsheet/presentation, list:, filename:, quoted exact phrases, parentheses, in:anywhere, in:archive, in:snoozed, is:muted, is:important/starred/unread/read, has:yellow-star/orange-star/red-star/purple-star/blue-star/green-star/red-bang/orange-guillemet/yellow-bang/green-check/blue-info/purple-question, deliveredto:, size:, larger:, smaller:, +term, rfc822msgid:, has:userlabels, has:nouserlabels, label:encryptedmail.`;

export const gmailSearchResultSchema = z.object({
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
});

export type GmailSearchResult = z.infer<typeof gmailSearchResultSchema>;

export const gmailSearchToolDef = toolDefinition({
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
  outputSchema: gmailSearchResultSchema,
});

export type GmailSearchToolContext = {
  category: MailboxCategory;
  searchGmail: (input: { maxResults: number; query: string }) => Promise<GmailSearchResult>;
};

export const createGmailSearchServerTool = (context: GmailSearchToolContext): ServerTool =>
  gmailSearchToolDef.server(async ({ query, maxResults }) => {
    try {
      return await context.searchGmail({ maxResults: maxResults ?? 5, query });
    } catch (error) {
      return {
        category: context.category,
        error: error instanceof Error ? error.message : "Gmail search failed.",
        messages: [],
        query,
      };
    }
  });
