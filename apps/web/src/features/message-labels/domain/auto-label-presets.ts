import {
  Airplane01Icon,
  ArrowTurnBackwardIcon,
  Briefcase01Icon,
  Building03Icon,
  Calendar03Icon,
  Invoice01Icon,
  Megaphone01Icon,
  MessageQuestionIcon,
  News01Icon,
  ReceiptDollarIcon,
  Shield01Icon,
  TruckDeliveryIcon,
} from "@hugeicons/core-free-icons";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";

export const autoLabelPresetCategories = [
  "All presets",
  "Everyday",
  "Finance",
  "Shopping",
  "Travel",
  "Work",
] as const;

export type AutoLabelPreset = {
  icon: typeof News01Icon;
  category: Exclude<(typeof autoLabelPresetCategories)[number], "All presets">;
  color: MailboxLabelColor;
  description: string;
  domains?: string[];
  examples: { sender: string; subject: string }[];
  id: string;
  name: string;
  prompt: string;
};

export const autoLabelPresets: AutoLabelPreset[] = [
  {
    category: "Everyday",
    color: "yellow",
    description: "Newsletters, digests, and a little weekend reading.",
    examples: [
      {
        sender: "The Sunday Edit",
        subject: "Five things worth reading this week",
      },
      { sender: "Design Notes", subject: "Your monthly design digest" },
    ],
    icon: News01Icon,
    id: "newsletters",
    name: "Newsletters",
    prompt:
      "Newsletters, editorial digests, and reading recommendations. Exclude transactional emails, account notices, and individual conversations.",
  },
  {
    category: "Everyday",
    color: "orange",
    description: "Sales, special offers, and product promotions.",
    examples: [
      { sender: "Studio Store", subject: "Our autumn sale starts today" },
      {
        sender: "Your favorite shop",
        subject: "A little something for your next order",
      },
    ],
    icon: Megaphone01Icon,
    id: "promotions",
    name: "Promotions",
    prompt:
      "Marketing emails, special offers, discount codes, sales announcements, and promotional product launches. Exclude order receipts, shipping updates, and personal recommendations from people I know.",
  },
  {
    category: "Everyday",
    color: "purple",
    description: "Questions and requests that need an answer.",
    examples: [
      { sender: "Alex", subject: "Could you review this before Friday?" },
      { sender: "Jamie", subject: "Which of these dates works for you?" },
    ],
    icon: MessageQuestionIcon,
    id: "needs-reply",
    name: "Needs a reply",
    prompt:
      "Personal or work conversations that ask me a direct question, request my input, or need a decision from me. Exclude automated notifications, newsletters, and no-reply messages.",
  },
  {
    category: "Everyday",
    color: "blue",
    description: "Sign-in codes, password resets, and account alerts.",
    examples: [
      { sender: "Account security", subject: "Your sign-in code" },
      {
        sender: "Account notifications",
        subject: "A new sign-in to your account",
      },
    ],
    icon: Shield01Icon,
    id: "security",
    name: "Account security",
    prompt:
      "Sign-in codes, password resets, two-factor authentication, account verification, and security alerts. Exclude billing notifications and promotional messages.",
  },
  {
    category: "Finance",
    color: "green",
    description: "Invoices, bills, and payment reminders.",
    examples: [
      { sender: "Acme billing", subject: "Your invoice for October" },
      {
        sender: "Accounts team",
        subject: "A reminder about your upcoming payment",
      },
    ],
    icon: Invoice01Icon,
    id: "invoices",
    name: "Invoices",
    prompt:
      "Invoices, bills, payment requests, due-date reminders, and notices about outstanding balances. Exclude promotional offers and receipts for payments already completed.",
  },
  {
    category: "Finance",
    color: "cyan",
    description: "Payment confirmations and receipts to keep.",
    examples: [
      { sender: "Acme receipts", subject: "Thanks, your payment was received" },
      { sender: "Studio Store", subject: "Your receipt for order #1042" },
    ],
    icon: ReceiptDollarIcon,
    id: "receipts",
    name: "Receipts",
    prompt:
      "Receipts and confirmations of completed payments, purchases, subscriptions, or donations. Exclude unpaid invoices, payment requests, and promotional offers.",
  },
  {
    category: "Shopping",
    color: "orange",
    description: "Orders, tracking links, and delivery updates.",
    examples: [
      { sender: "Studio Store", subject: "Your order is on its way" },
      { sender: "Delivery updates", subject: "Your package arrives tomorrow" },
    ],
    icon: TruckDeliveryIcon,
    id: "deliveries",
    name: "Orders & deliveries",
    prompt:
      "Order confirmations, shipping notifications, tracking updates, delivery notices, and collection instructions for physical purchases. Exclude advertisements and travel bookings.",
  },
  {
    category: "Shopping",
    color: "pink",
    description: "Return labels, refunds, and exchanges.",
    examples: [
      { sender: "Studio returns", subject: "Your return label is ready" },
      { sender: "Store support", subject: "We've processed your refund" },
    ],
    icon: ArrowTurnBackwardIcon,
    id: "returns",
    name: "Returns & refunds",
    prompt:
      "Return requests and authorizations, return shipping labels, exchanges, and refund confirmations. Exclude general marketing and ordinary shipping notices for new orders.",
  },
  {
    category: "Travel",
    color: "blue",
    description: "Flights, train tickets, and trip updates.",
    examples: [
      { sender: "Example Air", subject: "Your flight to Lisbon is confirmed" },
      { sender: "Rail tickets", subject: "Your tickets for Berlin to Hamburg" },
    ],
    icon: Airplane01Icon,
    id: "travel",
    name: "Travel plans",
    prompt:
      "Flight, train, bus, and rental car confirmations, tickets, boarding passes, check-in reminders, cancellations, and itinerary changes. Exclude travel advertising and destination newsletters.",
  },
  {
    category: "Travel",
    color: "purple",
    description: "Places to stay and tables booked along the way.",
    examples: [
      { sender: "Casa Hotel", subject: "Your stay is confirmed" },
      {
        sender: "The Corner Table",
        subject: "Your reservation for two on Saturday",
      },
    ],
    icon: Calendar03Icon,
    id: "reservations",
    name: "Reservations",
    prompt:
      "Hotel and accommodation reservations, restaurant bookings, booking confirmations, reminders, changes, and cancellations. Exclude advertising, offers, and transport tickets.",
  },
  {
    category: "Work",
    color: "cyan",
    description: "Invitations, scheduling, and meeting changes.",
    examples: [
      { sender: "Taylor", subject: "Invitation: Project catch-up" },
      { sender: "Morgan", subject: "Moving our call to Thursday" },
    ],
    icon: Calendar03Icon,
    id: "meetings",
    name: "Meetings",
    prompt:
      "Meeting invitations, scheduling conversations, availability requests, calendar updates, and cancellations. Exclude newsletters about events I have not registered for.",
  },
  {
    category: "Work",
    color: "pink",
    description: "Applications, interviews, and hiring conversations.",
    examples: [
      { sender: "Recruiting team", subject: "Next steps for your application" },
      { sender: "Casey", subject: "Interview availability next week" },
    ],
    icon: Briefcase01Icon,
    id: "hiring",
    name: "Hiring",
    prompt:
      "Job applications, candidate conversations, interview scheduling, recruitment outreach, and offer discussions. Exclude general career newsletters and job-board marketing digests.",
  },
  {
    category: "Work",
    color: "green",
    description: "Everyone at a company, including its subdomains.",
    domains: ["example.com", "*.example.com"],
    examples: [
      { sender: "alex@example.com", subject: "A quick update on the project" },
      { sender: "team@news.example.com", subject: "The latest from our team" },
    ],
    icon: Building03Icon,
    id: "company",
    name: "A company",
    prompt: "",
  },
];
