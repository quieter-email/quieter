import { describe, expect, test } from "vite-plus/test";

import { createMailReadChatTools } from "../src/chat/mail-tools";

describe("mail read chat tools", () => {
  test("build the read and search tools from the shared mail schemas", () => {
    const tools = createMailReadChatTools({
      category: "inbox",
      mailboxId: "mailbox-a",
      userId: "user-a",
    });
    expect(tools.read_mail_thread?.inputSchema).toBeDefined();
    expect(tools.search_mail?.inputSchema).toBeDefined();
  });
});
