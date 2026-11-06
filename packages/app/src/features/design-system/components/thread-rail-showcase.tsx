"use client";

import { Button } from "@quieter/ui/button";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { ThreadRail } from "@quieter/ui/thread-rail";
import type { ThreadRailItem } from "@quieter/ui/thread-rail";
import { useRef, useState } from "react";

const mailConversation: [string, string][] = [
  [
    "A quieter launch",
    "I've gathered everyone's notes in one thread. Let's make the first release feel considered, down to the smallest detail.",
  ],
  [
    "Start with the reading experience",
    "The message should have room to breathe. Everything around it can stay a little quieter.",
  ],
  [
    "A first look",
    "The new layout is ready to explore. I've kept the controls close and the conversation in focus.",
  ],
  [
    "A few notes on spacing",
    "The shorter header feels better. Can we give the message body the same comfortable rhythm?",
  ],
  [
    "Keep the useful details",
    "Sender, time, and attachments still need to be easy to find. Let's keep those together.",
  ],
  [
    "The long thread example",
    "Here's a conversation with plenty of replies. Finding an earlier message should feel effortless.",
  ],
  [
    "Finding our place",
    "Small marks could give us a sense of the whole thread without another list of subjects.",
  ],
  [
    "Something to try",
    "A little movement as you approach might be enough to make the marks feel discoverable.",
  ],
  [
    "Less, until you need it",
    "I like that the details appear only when you get close. The resting state can stay very simple.",
  ],
  [
    "A lighter preview",
    "One line for the subject, a little context underneath. That should be enough to recognize a message.",
  ],
  [
    "Following the conversation",
    "The shape should follow your position smoothly, even between two messages.",
  ],
  [
    "Back to the beginning",
    "Make sure we can reach the first and last messages just as comfortably as the ones in the middle.",
  ],
  [
    "A small adjustment",
    "The response feels better with a little softness when you change direction. Keep the left edge still.",
  ],
  [
    "An afternoon review",
    "The marks are quiet enough to sit beside the reading area. The preview gives them just enough context.",
  ],
  [
    "Ready for another look",
    "The latest version includes the keyboard path. You can inspect a message before choosing to jump.",
  ],
  [
    "The final details",
    "The light version should feel as restrained as the dark one. Keep the same hierarchy in both.",
  ],
  [
    "Everything in its place",
    "This feels ready for a longer conversation. Let's keep the component reusable for other kinds of threads.",
  ],
  [
    "Thanks, everyone",
    "All the small decisions add up. I'll send the finished preview around for one last look.",
  ],
];

const chatConversation: [string, string][] = [
  [
    "Help me plan a calmer week",
    "I'd like room for focused work, a few useful conversations, and some time away from the screen.",
  ],
  [
    "Start with what matters",
    "Let's choose the work that deserves your best attention, then leave space around it.",
  ],
  [
    "Monday is already quite full",
    "I have a morning review and two conversations in the afternoon. Could we work around those?",
  ],
  [
    "Give Monday one clear goal",
    "Keep the time between meetings for small follow-ups. Save your deeper work for a quieter morning.",
  ],
  [
    "What about the writing project?",
    "I've been putting off the first draft. I'd like to give it a proper start this week.",
  ],
  [
    "Protect a morning for it",
    "Set aside Tuesday morning for the first draft. Start with an outline and keep the afternoon flexible.",
  ],
  [
    "I also need to catch up on email",
    "A few long threads need a reply, but I don't want them to take over the day.",
  ],
  [
    "Make a little room at the edges",
    "Try a short email session after lunch. Finish the conversations that need a decision before opening new ones.",
  ],
  [
    "Can we leave Wednesday open?",
    "I'd love one day without a fixed plan. Sometimes that's when the best work happens.",
  ],
  [
    "Keep a little space",
    "Leave Wednesday mostly clear. A short check-in at the end can help you decide what Thursday needs.",
  ],
  [
    "Let's find the original outline",
    "Can you bring me back to the part where we talked about starting the draft?",
  ],
  [
    "A morning for the first draft",
    "Tuesday morning is your writing time. Begin with the outline, then follow the part that feels most clear.",
  ],
  [
    "That feels more manageable",
    "Could you pull the plan together without making every hour feel accounted for?",
  ],
  [
    "A week with room to move",
    "Monday has one goal. Tuesday is for writing. Wednesday stays open. Use Thursday and Friday to finish what matters.",
  ],
  [
    "One last thing",
    "Remind me to leave time for a walk, especially on the days when I work from home.",
  ],
  [
    "Leave the screen for a while",
    "A walk after lunch gives the afternoon a fresh start. The work will still be there when you return.",
  ],
];

const examples = {
  chat: chatConversation.map(([label, description], index) => ({
    description,
    id: `chat-${index}`,
    label,
    meta: index % 2 === 0 ? "You" : "Assistant",
  })),
  mail: mailConversation.map(([label, description], index) => ({
    description,
    id: `mail-${index}`,
    label,
    meta: `Message ${index + 1} of ${mailConversation.length}`,
  })),
} satisfies Record<string, ThreadRailItem[]>;

export const ThreadRailShowcase = () => {
  const [example, setExample] = useState<"mail" | "chat">("mail");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const items = examples[example];
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selected = items[selectedIndex];
  const highlightedStart = Math.max(0, selectedIndex);
  const highlightedIds = items
    .slice(highlightedStart, highlightedStart + 3)
    .map((item) => item.id);

  return (
    <Surface id="thread-rail" padding="compact" variant="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
        <fieldset aria-label="Example conversation" className="flex gap-1">
          <Button
            aria-pressed={example === "mail"}
            onClick={() => {
              setExample("mail");
              setSelectedId(null);
            }}
            variant="chip"
          >
            Mail thread
          </Button>
          <Button
            aria-pressed={example === "chat"}
            onClick={() => {
              setExample("chat");
              setSelectedId(null);
            }}
            variant="chip"
          >
            AI conversation
          </Button>
        </fieldset>
        <Text size="caption" tone="muted">
          {items.length} messages
        </Text>
      </div>
      <Surface chrome="inset" padding="none">
        <div
          className="relative flex min-h-88 items-center py-10 pl-8 sm:pl-16 pointer-coarse:pb-24"
          ref={interactionRef}
        >
          <ThreadRail
            activeId={selectedId}
            aria-label={
              example === "mail"
                ? "Messages in the mail thread"
                : "Turns in the AI conversation"
            }
            highlightedIds={highlightedIds}
            interactionRef={interactionRef}
            items={items}
            key={example}
            maxHeight={144}
            onSelect={setSelectedId}
          />
          <div className="pointer-events-none absolute right-6 bottom-6 left-6 text-right">
            <Text size="sm" tone="muted">
              Move closer. Follow the conversation.
            </Text>
            <Text className="mt-1" size="caption" tone="muted">
              Click a mark or preview to choose a message.
            </Text>
          </div>
        </div>
      </Surface>
      <div
        aria-live="polite"
        className="flex min-h-28 flex-col justify-center gap-1 p-4"
      >
        {selected === undefined ? (
          <>
            <Text size="sm" weight="medium">
              A small map of a long conversation.
            </Text>
            <Text size="sm" tone="muted">
              Approach to preview. Use the arrow keys to explore, then Enter to
              select.
            </Text>
          </>
        ) : (
          <>
            <Text size="micro" tone="muted">
              {selected.meta}
            </Text>
            <Text size="sm" weight="medium">
              {selected.label}
            </Text>
            <Text size="sm" tone="muted">
              {selected.description}
            </Text>
          </>
        )}
      </div>
    </Surface>
  );
};
