import type { aiMemory } from "@quieter/database/schema";

export type Fact = Pick<
  typeof aiMemory.$inferInsert,
  "key" | "content" | "metadata"
> &
  Partial<
    Pick<typeof aiMemory.$inferInsert, "status" | "expiresAt" | "importance">
  > & { owner?: "other" };
export type Scenario = {
  id: string;
  kind: "contract" | "quality-probe";
  facts: Fact[];
  agent: string;
  query: string;
  mailbox: "primary" | "secondary" | "shared";
  relevant: string[];
  forbidden: string[];
  edit?: { key: string; content: string };
};
const voice: Fact = {
  content: "Prefers concise warm replies with natural contractions.",
  key: "voice",
  metadata: { agents: ["all"], category: "writing_style" },
};
const recipient: Fact = {
  content: "With Alex, use informal German and playful greetings.",
  key: "alex",
  metadata: {
    agents: ["all"],
    category: "writing_style",
    correspondents: ["alex@example.test"],
  },
};
const distractors: Fact[] = Array.from({ length: 45 }, (_, index) => ({
  content: `Project ${index} is migrating its deployment pipeline.`,
  importance: 5,
  key: `project-${index}`,
  metadata: { agents: ["all"], category: "work" },
}));
export const memoryRecallScenarios: Scenario[] = [
  {
    agent: "reply_suggestion",
    facts: [voice, recipient, ...distractors],
    forbidden: [],
    id: "recipient-and-general-voice",
    kind: "contract",
    mailbox: "primary",
    query: "Reply to alex@example.test about lunch",
    relevant: ["voice", "alex"],
  },
  {
    agent: "reply_suggestion",
    facts: [voice, recipient],
    forbidden: ["alex"],
    id: "recipient-exclusion",
    kind: "contract",
    mailbox: "primary",
    query: "Reply to blair@example.test",
    relevant: ["voice"],
  },
  {
    agent: "search",
    facts: [
      {
        content: "The user's husband is Blair, blair@example.test.",
        key: "partner",
        metadata: { agents: ["all"], category: "relationships" },
      },
      ...distractors,
    ],
    forbidden: [],
    id: "relationship-reference",
    kind: "contract",
    mailbox: "primary",
    query: "Find messages from my husband",
    relevant: ["partner"],
  },
  {
    agent: "chat",
    facts: [
      voice,
      {
        content: "Other reader prefers long formal introductions.",
        key: "foreign",
        metadata: { agents: ["all"], category: "writing_style" },
        owner: "other",
      },
    ],
    forbidden: ["foreign"],
    id: "shared-mailbox-personal-isolation",
    kind: "contract",
    mailbox: "shared",
    query: "What are my writing preferences?",
    relevant: ["voice"],
  },
  {
    agent: "compose",
    facts: [voice],
    forbidden: [],
    id: "general-preferences-cross-mailboxes",
    kind: "contract",
    mailbox: "secondary",
    query: "Draft a message",
    relevant: ["voice"],
  },
  {
    agent: "auto_label",
    facts: [
      {
        content: "Prefer the Travel label for itinerary confirmations.",
        key: "label",
        metadata: { agents: ["all"], category: "labeling" },
      },
    ],
    forbidden: [],
    id: "label-rule-origin",
    kind: "contract",
    mailbox: "primary",
    query: "Travel itinerary",
    relevant: ["label"],
  },
  {
    agent: "auto_label",
    facts: [
      {
        content: "Prefer the Travel label for itinerary confirmations.",
        key: "label",
        metadata: { agents: ["all"], category: "labeling" },
      },
    ],
    forbidden: ["label"],
    id: "label-rule-other-mailbox",
    kind: "contract",
    mailbox: "secondary",
    query: "Travel itinerary",
    relevant: [],
  },
  {
    agent: "compose",
    facts: [
      voice,
      {
        content: "Temporarily prefers formal greetings.",
        expiresAt: new Date("2020-01-01"),
        key: "expired",
        metadata: { category: "preferences" },
      },
      {
        content: "Prefers elaborate email signatures.",
        key: "archived",
        metadata: { category: "writing_style" },
        status: "archived",
      },
    ],
    forbidden: ["expired", "archived"],
    id: "expired-and-archived",
    kind: "contract",
    mailbox: "primary",
    query: "Draft a greeting and signature",
    relevant: ["voice"],
  },
  {
    agent: "compose",
    edit: {
      content: "Prefers detailed explanations with a formal greeting.",
      key: "voice",
    },
    facts: [voice],
    forbidden: [],
    id: "manual-edit-freshness",
    kind: "contract",
    mailbox: "primary",
    query: "Draft a reply",
    relevant: ["voice"],
  },
  {
    agent: "chat",
    facts: [
      {
        content: "Avoids red-eye flights.",
        importance: 1,
        key: "flight",
        metadata: { agents: ["all"], category: "preferences" },
      },
      ...Array.from({ length: 30 }, (_, index): Fact => ({
        content: `Prefers the ${index}th garden layout in the landscape catalog.`,
        importance: 5,
        key: `preference-${index}`,
        metadata: { agents: ["all"], category: "preferences" },
      })),
    ],
    forbidden: [],
    id: "word-disjoint-semantic-recall",
    kind: "quality-probe",
    mailbox: "primary",
    query: "How should I choose an overnight journey by air?",
    relevant: ["flight"],
  },
  ...[
    {
      content: "Eats a vegan diet.",
      id: "semantic-plant-based",
      key: "diet",
      query: "Which meals suit me without animal products?",
    },
    {
      content: "Uses a wheelchair and needs step-free venues.",
      id: "semantic-german-accessibility",
      key: "accessibility",
      query: "Was muss ich bei barrierefreien Veranstaltungsorten beachten?",
    },
    {
      content: "Needs a distraction-free environment for focused work.",
      id: "semantic-quiet-work",
      key: "focus",
      query: "What kind of setting helps me concentrate amid interruptions?",
    },
    {
      content: "Eats a vegan diet.",
      id: "semantic-spanish-diet",
      key: "diet",
      query: "¿Qué puedo pedir sin productos de origen animal?",
    },
    {
      content: "Needs a distraction-free environment for focused work.",
      id: "semantic-french-focus",
      key: "focus",
      query: "Quel endroit me permet de me concentrer sans être dérangé ?",
    },
    {
      content: "Uses a wheelchair and needs step-free venues.",
      id: "semantic-japanese-accessibility",
      key: "accessibility",
      query: "段差のない会場を選ぶ必要があるのはなぜですか？",
    },
    {
      content: "Avoids red-eye flights.",
      id: "semantic-arabic-travel",
      key: "flight",
      query: "ما الذي أفضله عند حجز رحلة جوية خلال الليل؟",
    },
    {
      content: "Reist am liebsten mit der Bahn und vermeidet Inlandsflüge.",
      id: "semantic-german-source-english-query",
      key: "domestic-travel",
      query: "How do I prefer to travel between cities within the country?",
    },
  ].map(({ content, id, key, query }): Scenario => ({
    agent: "chat",
    facts: [
      {
        content,
        importance: 1,
        key,
        metadata: { agents: ["all"], category: "preferences" },
      },
      ...Array.from({ length: 30 }, (_, index): Fact => ({
        content: `Prefers the ${index}th garden layout in the landscape catalog.`,
        importance: 5,
        key: `preference-${index}`,
        metadata: { agents: ["all"], category: "preferences" },
      })),
    ],
    forbidden: [],
    id,
    kind: "quality-probe",
    mailbox: "primary",
    query,
    relevant: [key],
  })),
];
