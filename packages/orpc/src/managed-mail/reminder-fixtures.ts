export const buildLocalReminderFixtures = (input: {
  address: string;
  receivedAt: Date;
  suffix: string;
  reply?: "acknowledgement" | "fulfilled";
}) => {
  const deadline = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeZone: "Europe/Berlin",
  }).format(new Date(input.receivedAt.getTime() + 3 * 24 * 60 * 60_000));
  const anchorId = `<reminder-follow-up-v1.${input.suffix}@quieter.test>`;
  const fixtures = input.reply
    ? [
        {
          body:
            input.reply === "fulfilled"
              ? "Here is the revised quote. The equipment costs EUR 800 and installation costs EUR 200, for a complete installed total of EUR 1000. Both items are included in this revised quote."
              : "Thanks, I received your request. I will send the revised quote later.",
          key: `reminder-reply-${input.reply}-v1`,
          subject: "Re: Revised quote with installation",
        },
      ]
    : [
        {
          body: `Please send your feedback on the proposal by ${deadline} at 17:00 CET. We need your decision before we can confirm the next steps.`,
          key: "reminder-deadline-v1",
          subject: "Feedback needed on the proposal",
        },
        {
          body: `Please return the signed contract by ${deadline}. We need your signature to complete your application.`,
          key: "reminder-date-only-v1",
          subject: "Return the signed contract",
        },
        {
          body: `Our seasonal sale ends on ${deadline} at 17:00 CET. Save 20% on selected items. Shop now or unsubscribe from this newsletter.`,
          key: "reminder-promotion-v1",
          subject: "Our seasonal sale ends soon",
        },
        {
          body: "I received your request for a revised quote including installation. I will get back to you.",
          key: "reminder-follow-up-v1",
          subject: "Revised quote with installation",
        },
      ];
  return fixtures.map((fixture) => ({
    messageKey: fixture.key,
    raw: new TextEncoder().encode(
      [
        "From: Maya Chen <maya@example.test>",
        `To: ${input.address}`,
        `Subject: ${fixture.subject}`,
        `Message-ID: <${fixture.key}.${input.suffix}@quieter.test>`,
        `Date: ${input.receivedAt.toUTCString()}`,
        ...(input.reply
          ? [`In-Reply-To: ${anchorId}`, `References: ${anchorId}`]
          : []),
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        fixture.body,
        "",
      ].join("\r\n")
    ),
    subject: fixture.subject,
  }));
};
