type FixtureMessage = {
  attachment?: { content: string; fileName: string; mimeType: string };
  body: string;
  from: string;
  id: string;
  isRead: boolean;
  label?: "Clients" | "Finance" | "Product";
  references?: string[];
  subject: string;
  timestamp: string;
};

const messages: readonly FixtureMessage[] = [
  {
    attachment: {
      content:
        "payout,amount,status\npayout_fixture_1,128.50,paid\npayout_fixture_2,64.00,review\n",
      fileName: "april-payouts.csv",
      mimeType: "text/csv",
    },
    body: "Your April payout reconciliation is ready.\n\nThere are two failed transfers that need review before the end of the week. The CSV includes the payout IDs, transfer amounts, and current retry status.",
    from: "Stripe <notifications@stripe.example.test>",
    id: "stripe-v1",
    isRead: false,
    label: "Finance",
    subject: "April payout reconciliation",
    timestamp: "2026-09-07T14:00:00Z",
  },
  {
    body: "The workflow web / typecheck failed on pull request #184.\n\nThe failing package is @quieter/web. Review the compiler output before merging.",
    from: "GitHub <notifications@github.example.test>",
    id: "github-v1",
    isRead: false,
    label: "Product",
    subject: "[quieter] web / typecheck failed",
    timestamp: "2026-09-07T11:00:00Z",
  },
  {
    body: "Alex mentioned you in QTR-312 Demo mode fixture coverage.\n\nCan we include at least one threaded conversation, a couple of attachments, and a sent reply so the walkthrough feels realistic?",
    from: "Linear <notifications@linear.example.test>",
    id: "linear-v1",
    isRead: false,
    label: "Product",
    subject: "Mentioned in QTR-312 Demo mode fixture coverage",
    timestamp: "2026-09-07T08:00:00Z",
  },
  {
    body: "Hi everyone,\n\nI drafted the customer onboarding checklist in Notion. The sections that still need owner names are highlighted in yellow.",
    from: "Mara Quill <mara@notion.example.test>",
    id: "onboarding-1-v1",
    isRead: true,
    label: "Product",
    subject: "Onboarding checklist draft",
    timestamp: "2026-09-06T15:00:00Z",
  },
  {
    body: "Looks good. I added the lifecycle emails and moved the workspace invite step earlier.\n\nTheo, can you check the screenshots before we share it?",
    from: "Alex Morgan <alex@quieter.example.test>",
    id: "onboarding-2-v1",
    isRead: true,
    label: "Product",
    references: ["onboarding-1-v1"],
    subject: "Re: Onboarding checklist draft",
    timestamp: "2026-09-06T19:00:00Z",
  },
  {
    body: "I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.",
    from: "Theo Byte <theo@figma.example.test>",
    id: "onboarding-3-v1",
    isRead: false,
    label: "Product",
    references: ["onboarding-1-v1", "onboarding-2-v1"],
    subject: "Re: Onboarding checklist draft",
    timestamp: "2026-09-06T23:00:00Z",
  },
  {
    body: "Your preview deployment is ready.\n\nquieter-web-git-demo-mode built successfully and is available for review.",
    from: "Vercel <notifications@vercel.example.test>",
    id: "vercel-v1",
    isRead: true,
    label: "Product",
    subject: "Preview deployment ready",
    timestamp: "2026-09-06T12:00:00Z",
  },
  {
    body: "You have 4 unread mentions in #product.\n\nThe most recent thread is about the new mailbox switcher behavior.",
    from: "Slack <notifications@slack.example.test>",
    id: "slack-v1",
    isRead: true,
    subject: "New mentions in #product",
    timestamp: "2026-09-05T21:00:00Z",
  },
  {
    body: "Your weekly usage summary is ready.\n\nToken volume increased 18% week over week, mostly from background classification jobs.",
    from: "OpenAI <support@openai.example.test>",
    id: "openai-v1",
    isRead: true,
    label: "Finance",
    subject: "Weekly usage summary",
    timestamp: "2026-09-05T10:00:00Z",
  },
  {
    body: "The Quieter swag test order shipped today.\n\nTracking usually appears within 24 hours after the carrier scan.",
    from: "Shopify <orders@shopify.example.test>",
    id: "shopify-v1",
    isRead: true,
    subject: "Your test order shipped",
    timestamp: "2026-09-04T18:00:00Z",
  },
  {
    body: "Here is the latest research export from Airtable. I filtered it down to accounts with active pilot conversations.",
    from: "Nova Reed <nova@airtable.example.test>",
    id: "airtable-v1",
    isRead: true,
    label: "Clients",
    subject: "Pilot account research export",
    timestamp: "2026-09-04T08:00:00Z",
  },
  {
    body: "Milo shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and customer quote approvals.",
    from: "Dropbox <no-reply@dropbox.example.test>",
    id: "dropbox-v1",
    isRead: true,
    subject: "Q2 launch folder shared with you",
    timestamp: "2026-09-03T13:00:00Z",
  },
];

export const createLocalFixtureCorpus = (address: string, suffix: string) => {
  if (
    !/^[a-z0-9-]+$/u.test(suffix) ||
    !/^[a-z0-9-]+@[a-z0-9.-]+\.test$/u.test(address)
  ) {
    throw new Error(
      "Local mail fixtures require a reserved .test address and a safe namespace."
    );
  }
  return messages.map((message) => {
    const references = message.references?.map(
      (id) => `<${id}.${suffix}@quieter.test>`
    );
    const headers = [
      `From: ${message.from}`,
      `To: ${address}`,
      `Subject: ${message.subject}`,
      `Message-ID: <${message.id}.${suffix}@quieter.test>`,
      `Date: ${new Date(message.timestamp).toUTCString()}`,
      ...(references
        ? [
            `In-Reply-To: ${references.at(-1)}`,
            `References: ${references.join(" ")}`,
          ]
        : []),
      "MIME-Version: 1.0",
    ];
    const body = message.body.replaceAll("\n", "\r\n");
    const raw = new TextEncoder().encode(
      message.attachment
        ? [
            ...headers,
            'Content-Type: multipart/mixed; boundary="quieter-local-corpus"',
            "",
            "--quieter-local-corpus",
            'Content-Type: text/plain; charset="utf-8"',
            "",
            body,
            "",
            "--quieter-local-corpus",
            `Content-Type: ${message.attachment.mimeType}; name="${message.attachment.fileName}"`,
            `Content-Disposition: attachment; filename="${message.attachment.fileName}"`,
            "Content-Transfer-Encoding: base64",
            "",
            btoa(message.attachment.content),
            "--quieter-local-corpus--",
            "",
          ].join("\r\n")
        : [
            ...headers,
            'Content-Type: text/plain; charset="utf-8"',
            "",
            body,
            "",
          ].join("\r\n")
    );
    return {
      isRead: message.isRead,
      key: `fixtures/${suffix}/${message.id}.eml`,
      label: message.label,
      providerMessageId: `local-${message.id}-${suffix}`,
      raw,
      receivedAt: new Date(message.timestamp),
    };
  });
};
