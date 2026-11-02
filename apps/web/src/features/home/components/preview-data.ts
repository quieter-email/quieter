export const previewMessages = [
  {
    address: "alex@example.com",
    body: "I like the direction. Can you send the timeline by Friday? It would be good to go through it together next week.",
    id: "proposal",
    sender: "Alex Morgan",
    subject: "A few thoughts on the proposal",
    summary: "Alex: Approved. Can you send a timeline by Friday?",
    title: "Re: Project proposal",
  },
  {
    address: "travel@example.com",
    body: "Your flights and hotel are confirmed. Everything is ready for your trip. Have a great time!",
    id: "travel",
    sender: "Travel desk",
    subject: "Your trip confirmation",
    summary: "Travel desk: Your flights and hotel are confirmed.",
    title: "Your trip confirmation",
  },
  {
    address: "sam@example.com",
    body: "Does Thursday morning work for you? I’d love to catch up over coffee.",
    id: "coffee",
    sender: "Sam",
    subject: "Coffee with Sam",
    summary: "Sam: Does Thursday morning work for you?",
    title: "Coffee with Sam",
  },
] as const;

export type PreviewMessage = (typeof previewMessages)[number];

export const previewSnippets = [
  {
    body: "Thanks for reaching out. I’ll take a look and get back to you shortly.",
    title: "Thanks for reaching out",
  },
  {
    body: "Great talking with you today. Here are the next steps we discussed. Please let me know if I missed anything.",
    title: "A quick follow-up",
  },
] as const;

export const initialPreviewDraft =
  "Hey Alex,\n\nGlad you like the direction. I’ll send the timeline by Friday.\n\nTuesday afternoon works for me.";
