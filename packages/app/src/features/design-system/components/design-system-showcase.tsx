"use client";

import {
  Delete02Icon,
  FileAttachmentIcon,
  Mail01Icon,
  Refresh01Icon,
  Search01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import { MobileHeader } from "@quieter/app/components/mobile-header";
import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import { toastError } from "@quieter/app/lib/error-toast";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@quieter/ui/accordion";
import { ActionFooter } from "@quieter/ui/action-footer";
import {
  AlertDialog,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@quieter/ui/alert-dialog";
import { Autocomplete } from "@quieter/ui/autocomplete";
import { Button, LinkButton } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import { useColorMode } from "@quieter/ui/color-mode";
import {
  ComposerActionBar,
  ComposerContextChip,
  PromptComposerFrame,
} from "@quieter/ui/composer-chrome";
import { DatePicker } from "@quieter/ui/date-picker";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quieter/ui/dialog";
import {
  Drawer,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@quieter/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { InputAddon, InputGroup } from "@quieter/ui/input-group";
import {
  MailListRowDetails,
  MailListRowMetadata,
  mailListRowFrameVariants,
} from "@quieter/ui/mail-list-row";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import { Schedule } from "@quieter/ui/schedule";
import type { ScheduleItem, ScheduleProps } from "@quieter/ui/schedule";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import {
  SettingsCard,
  SettingsFieldRow,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsSectionLayout,
} from "@quieter/ui/settings-layout";
import { SuccessPulse } from "@quieter/ui/success-pulse";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { ThemePicker } from "@quieter/ui/theme-picker";
import { TimePicker } from "@quieter/ui/time-picker";
import { toast } from "@quieter/ui/toast";
import { TokenField } from "@quieter/ui/token-field";
import type { TokenFieldToken } from "@quieter/ui/token-field";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { CalendarTimeZonePicker } from "../../calendar/components/calendar-time-zone-picker";

// Sample data only. Real mentions come from the user's connected apps.
const showcaseTokens: TokenFieldToken[] = [
  {
    description: "Sample app",
    id: "sample-tracker",
    label: "Tracker",
    text: "@Tracker",
    tone: "purple",
  },
  {
    description: "Sample app",
    id: "sample-calendar",
    label: "Calendar",
    text: "@Calendar",
    tone: "blue",
  },
];

// Literal classes: Tailwind cannot extract an interpolated `bg-${name}`.
const surfaceTokens = [
  { cls: "bg-bg", name: "bg", note: "canvas" },
  { cls: "bg-bg-raised", name: "bg-raised", note: "raised" },
  { cls: "bg-bg-surface", name: "bg-surface", note: "surface" },
  { cls: "bg-card", name: "card", note: "raised, both themes" },
  { cls: "bg-muted", name: "muted", note: "alias of control-hover" },
  { cls: "bg-secondary", name: "secondary", note: "secondary actions" },
  {
    cls: "bg-control",
    name: "control",
    note: "fields, quiet buttons, popovers",
  },
  {
    cls: "bg-control-hover",
    name: "control-hover",
    note: "hover, menu highlight",
  },
  { cls: "bg-control-active", name: "control-active", note: "pressed" },
];

const textTokens = [
  { cls: "text-display-lg", name: "display-lg" },
  { cls: "text-display-md", name: "display-md" },
  { cls: "text-title-lg", name: "title-lg" },
  { cls: "text-title-md", name: "title-md" },
  { cls: "text-title-sm", name: "title-sm" },
  { cls: "text-body-lg", name: "body-lg" },
  { cls: "text-body", name: "body" },
  { cls: "text-body-sm", name: "body-sm" },
  { cls: "text-caption", name: "caption" },
  { cls: "text-micro", name: "micro" },
];

const pillTones: PillTone[] = [
  "gray",
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
];

const statusTones: PillTone[] = ["neutral", "success", "destructive"];

const scheduleDates = {
  agenda: Array.from({ length: 30 }, (_, offset) =>
    new Date(Date.UTC(2026, 9, 19 + offset)).toISOString().slice(0, 10)
  ),
  day: ["2026-10-23"],
  month: Array.from({ length: 42 }, (_, offset) =>
    new Date(Date.UTC(2026, 8, 28 + offset)).toISOString().slice(0, 10)
  ),
  week: Array.from({ length: 7 }, (_, offset) =>
    new Date(Date.UTC(2026, 9, 19 + offset)).toISOString().slice(0, 10)
  ),
};

const sampleScheduleItems: ScheduleItem[] = [
  {
    allDay: true,
    color: "#33b679",
    date: "2026-10-21",
    endMinute: 1440,
    id: "sample-release",
    startMinute: 0,
    title: "Release day",
    tone: "success",
  },
  {
    allDay: false,
    color: "#039be5",
    date: "2026-10-20",
    detail: "Studio",
    endMinute: 660,
    id: "sample-design",
    startMinute: 570,
    title: "Design review",
    tone: "primary",
  },
  {
    allDay: false,
    date: "2026-10-20",
    endMinute: 690,
    id: "sample-overlap",
    startMinute: 630,
    title: "Customer conversation",
    tone: "warning",
  },
  {
    allDay: false,
    date: "2026-10-22",
    detail: "Time to think",
    endMinute: 900,
    id: "sample-focus",
    startMinute: 780,
    title: "Focus time",
    tone: "muted",
  },
  {
    allDay: false,
    date: "2026-10-23",
    endMinute: 630,
    id: "sample-planning",
    startMinute: 570,
    title: "Weekly planning",
    tone: "primary",
  },
  {
    allDay: false,
    date: "2026-10-23",
    endMinute: 720,
    id: "sample-walk",
    startMinute: 690,
    title: "A walk outside",
    tone: "success",
  },
  {
    allDay: false,
    date: "2026-10-23",
    endMinute: 810,
    id: "sample-lunch",
    startMinute: 750,
    title: "Lunch with the team",
    tone: "warning",
  },
  {
    allDay: false,
    date: "2026-10-23",
    endMinute: 960,
    id: "sample-wrap",
    startMinute: 900,
    title: "Wrap up the week",
    tone: "muted",
  },
  {
    allDay: false,
    color: "#000000",
    date: "2026-10-21",
    endMinute: 555,
    id: "sample-short-black",
    startMinute: 540,
    title: "Quick check-in",
  },
  {
    allDay: false,
    color: "#ffffff",
    date: "2026-10-21",
    endMinute: 600,
    id: "sample-short-white",
    startMinute: 570,
    title: "Review notes and next steps with the team",
  },
  {
    allDay: false,
    color: "#ffff00",
    date: "2026-10-22",
    endMinute: 585,
    id: "sample-short-yellow",
    startMinute: 540,
    title: "Project catch-up",
  },
  {
    allDay: false,
    color: "#800080",
    date: "2026-10-22",
    detail: "A longer conversation",
    endMinute: 705,
    id: "sample-purple",
    startMinute: 615,
    title: "Planning the next chapter of the product together",
  },
];

const ScheduleShowcase = () => {
  const [view, setView] = useState<ScheduleProps["view"]>("week");
  const [items, setItems] = useState(sampleScheduleItems);
  const [selectedId, setSelectedId] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const creationPreview: ScheduleItem = {
    allDay: false,
    date: "2026-10-23",
    detail: "Still being configured",
    endMinute: 675,
    id: "sample-creation-preview",
    preview: true,
    startMinute: 630,
    title: "Draft appointment",
    tone: "purple",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          ["day", "week", "month", "agenda"] satisfies ScheduleProps["view"][]
        ).map((option) => (
          <Button
            aria-pressed={view === option}
            key={option}
            onClick={() => {
              setView(option);
            }}
            size="sm"
            variant="option"
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </Button>
        ))}
        <Button
          aria-pressed={showPreview}
          onClick={() => {
            setShowPreview((previous) => !previous);
          }}
          size="sm"
          variant="option"
        >
          Preview a new event
        </Button>
        <Button
          onClick={() => {
            setItems(sampleScheduleItems);
            setSelectedId(undefined);
            setShowPreview(false);
          }}
          size="sm"
          variant="secondary"
        >
          Reset example
        </Button>
      </div>
      <div className="flex h-112 flex-col overflow-hidden rounded-md border border-border bg-card">
        <Schedule
          currentMinute={640}
          dates={scheduleDates[view]}
          items={showPreview ? [...items, creationPreview] : items}
          onEventClick={setSelectedId}
          onEventMove={({ allDay, date, id, minute }) => {
            setItems((previous) =>
              previous.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      allDay,
                      date,
                      endMinute: allDay
                        ? 1440
                        : minute +
                          Math.max(
                            30,
                            item.allDay ? 60 : item.endMinute - item.startMinute
                          ),
                      startMinute: allDay ? 0 : minute,
                    }
                  : item
              )
            );
          }}
          onEventResize={({ endMinute, id }) => {
            setItems((previous) =>
              previous.map((item) =>
                item.id === id ? { ...item, endMinute } : item
              )
            );
          }}
          onSlotCreate={({ allDay, date, endMinute, minute }) => {
            setItems((previous) => [
              ...previous,
              {
                allDay,
                date,
                endMinute: allDay
                  ? 1440
                  : (endMinute ?? Math.min(1440, minute + 30)),
                id: crypto.randomUUID(),
                startMinute: minute,
                title: "New event",
                tone: "primary",
              },
            ]);
          }}
          selectedDate={view === "day" ? "2026-10-23" : "2026-10-22"}
          selectedId={showPreview ? creationPreview.id : selectedId}
          today="2026-10-23"
          view={view}
        />
      </div>
      <p className="text-caption text-muted-fg">
        {selectedId
          ? `Selected ${items.find((item) => item.id === selectedId)?.title ?? "event"}.`
          : "Choose a slot to add an event. Drag events to move them, or use the bottom handle and arrow keys to resize."}
      </p>
    </div>
  );
};

const Section = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) => (
  <section className="border-t border-border pt-8">
    <Text as="h2" size="lg" truncate weight="medium">
      {title}
    </Text>
    {description === undefined ? null : (
      <p className="mt-1 text-body-sm text-muted-fg">{description}</p>
    )}
    <div className="mt-5">{children}</div>
  </section>
);

const Row = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className="flex flex-col gap-2 py-3 @md:flex-row @md:items-center @md:gap-6">
    <p className="w-44 shrink-0 text-body-sm text-muted-fg">{label}</p>
    <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
  </div>
);

const copySampleKey = async () => {
  try {
    await navigator.clipboard.writeText(
      "example_key_for_documentation_only_not_a_real_credential"
    );
    toast.success("Copied sample key.");
  } catch (error) {
    toastError(error, {
      boundary: "clipboard",
      fallback: "Could not copy sample key.",
    });
  }
};

export const DesignSystemShowcase = () => {
  const { colorMode, setColorMode } = useColorMode();
  const [entrancePreview, setEntrancePreview] = useState(0);
  const [successPulse, setSuccessPulse] = useState(false);
  const [checked, setChecked] = useState(true);
  const [tokenFieldValue, setTokenFieldValue] = useState(
    "When it's a bug, use @Tracker to file it."
  );
  const [boxChecked, setBoxChecked] = useState(true);
  const [inlineName, setInlineName] = useState("Project updates");
  const [inlineNameDraft, setInlineNameDraft] = useState<string | null>(null);
  const focusNameInput = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
    input?.select();
  }, []);
  const [labelColor, setLabelColor] = useState<MailboxLabelColor>("blue");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [showPromptContext, setShowPromptContext] = useState(true);
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("2026-10-27");
  const [time, setTime] = useState("14:35");
  const [timeZone, setTimeZone] = useState("Europe/Berlin");

  return (
    <main className="@container min-h-dvh text-fg">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
        <header>
          <Text as="h1" size="lg" truncate weight="medium">
            Quieter design system
          </Text>
          <p className="mt-2 max-w-prose text-body-sm text-muted-fg">
            Every control the product composes from. If a surface needs
            something that is not here, extend a primitive rather than inventing
            one locally. Use the theme controls to review the same components
            across palettes.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setColorMode(colorMode === "dark" ? "light" : "dark");
              }}
              variant="secondary"
            >
              {colorMode === "dark" ? "Switch to light" : "Switch to dark"}
            </Button>
            <ThemePicker />
          </div>
        </header>

        <Section
          description="The canvas, raised panels, and control states use semantic roles in every theme."
          title="Surfaces"
        >
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
            {surfaceTokens.map((token) => (
              <div
                className={cn(
                  "rounded-md border border-border p-4 squircle",
                  token.cls
                )}
                key={token.name}
              >
                <p className="text-body-sm font-medium text-fg">{token.name}</p>
                <p className="text-micro text-muted-fg">{token.note}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Borders">
          <div className="flex flex-wrap gap-3">
            <div className="rounded-md border border-border px-4 py-3 text-body-sm squircle">
              border
            </div>
            <div className="rounded-md border border-border-strong px-4 py-3 text-body-sm squircle">
              border-strong
            </div>
          </div>
        </Section>

        <Section
          description="Product icons share one stroke weight. Small controls use 14px icons, standard controls use 16px, and prominent actions use 20px."
          title="Icons"
        >
          <div className="flex flex-wrap items-center gap-8">
            {[14, 16, 20].map((size) => (
              <div className="flex items-center gap-3" key={size}>
                <Icon icon={Mail01Icon} size={size} />
                <Icon icon={Refresh01Icon} size={size} />
                <Icon icon={Tick01Icon} size={size} />
                <span className="text-caption text-muted-fg">{size}px</span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          description="Every size in the product comes from this scale. No arbitrary sizes: if a design lands between two steps, take the smaller one."
          title="Typography"
        >
          <div className="space-y-2">
            {textTokens.map((token) => (
              <div className="flex items-baseline gap-4" key={token.name}>
                <span className="w-28 shrink-0 text-micro text-muted-fg">
                  {token.name}
                </span>
                <span className={cn("truncate text-fg", token.cls)}>
                  Quiet structure
                </span>
              </div>
            ))}
          </div>
          <Row label="Product headings">
            <Text as="h3" size="lg" weight="medium">
              Workspace heading
            </Text>
            <Text as="h3" size="title" weight="medium">
              Welcome back
            </Text>
          </Row>
          <Row label="Dense text">
            <Text size="sm" weight="medium">
              Section heading
            </Text>
            <Text size="sm" tone="muted">
              Supporting text
            </Text>
          </Row>
          <Row label="Truncated heading">
            <Text
              as="h3"
              className="max-w-48"
              size="sm"
              truncate
              weight="medium"
            >
              A long heading keeps its place without wrapping onto another line
            </Text>
          </Row>
        </Section>

        <Section title="Sender avatars">
          <Row label="Sizes">
            <SenderAvatar fallbackLabel="S" size="xs" />
            <SenderAvatar fallbackLabel="N" size="sm" />
            <SenderAvatar fallbackLabel="A" />
          </Row>
        </Section>

        <Section
          description="Stacked rows keep two lines. Adaptive rows place the sender, subject, and metadata on one line when their list container is wide enough."
          title="Mail list rows"
        >
          <div className="@container space-y-3">
            <div
              className={mailListRowFrameVariants({
                accent: "yellow",
                layout: "stacked",
              })}
            >
              <MailListRowDetails
                layout="stacked"
                metadata={
                  <Pill size="xs" tone="neutral">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Icon aria-hidden icon={FileAttachmentIcon} size={12} />2
                    </span>
                  </Pill>
                }
                sender="Nora Patel"
                senderEmail="nora@example.test"
                subject="The updated project files are ready for your review"
                subjectTrailing={
                  <Pill size="xs" tone="blue">
                    Work
                  </Pill>
                }
                timestamp="10:42"
                unread
              />
            </div>
            <div
              className={mailListRowFrameVariants({
                accent: "yellow",
                layout: "adaptive",
              })}
            >
              <MailListRowDetails
                active
                metadata={
                  <MailListRowMetadata
                    attachmentCount={2}
                    attachmentNames={["Project brief.pdf", "Budget.xlsx"]}
                    layout="adaptive"
                    messageCount={4}
                  />
                }
                badge={
                  <Pill size="xs" tone="purple">
                    Team
                  </Pill>
                }
                layout="adaptive"
                sender="Alex Morgan"
                senderEmail="alex@example.test"
                senderPrefix="To "
                subject="A longer subject stays on one line and truncates when the list gets narrower"
                subjectTrailing={
                  <>
                    <Pill size="xs" tone="blue">
                      Work
                    </Pill>
                    <Pill size="xs" tone="purple">
                      Projects
                    </Pill>
                    <Pill size="xs" tone="green">
                      Follow up
                    </Pill>
                  </>
                }
                timestamp="Yesterday"
              />
            </div>
            <div className={mailListRowFrameVariants({ layout: "adaptive" })}>
              <MailListRowDetails
                layout="adaptive"
                sender="Nora Patel"
                senderEmail="nora@example.test"
                subject="Optional labels and counts keep the same column positions"
                subjectTrailing={
                  <Pill size="xs" tone="blue">
                    Work
                  </Pill>
                }
                timestamp="10:42"
              />
            </div>
          </div>
        </Section>

        <Section title="Success feedback">
          <Button
            disabled={successPulse}
            onClick={() => {
              setSuccessPulse(true);
            }}
            type="button"
            variant="secondary"
          >
            <SuccessPulse
              active={successPulse}
              onComplete={() => {
                setSuccessPulse(false);
              }}
            >
              <Icon aria-hidden icon={Tick01Icon} />
            </SuccessPulse>
            Try success pulse
          </Button>
        </Section>
        <Section title="Buttons">
          <Row label="Variants">
            <Button type="button">Primary</Button>
            <Button type="button" variant="secondary">
              Secondary
            </Button>
            <Button type="button" variant="outline">
              Outline
            </Button>
            <Button type="button" variant="ghost">
              Ghost
            </Button>
            <Button type="button" variant="destructive">
              Destructive
            </Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm" type="button">
              Small
            </Button>
            <Button type="button">Default</Button>
            <Button size="lg" type="button">
              Large
            </Button>
          </Row>
          <Row label="Icon, with tooltip">
            <IconButtonTooltip label="Delete">
              <Button aria-label="Delete" size="icon-sm" variant="destructive">
                <Icon aria-hidden icon={Delete02Icon} />
              </Button>
            </IconButtonTooltip>
            <IconButtonTooltip label="Mail">
              <Button aria-label="Mail" size="icon" variant="ghost">
                <Icon aria-hidden icon={Mail01Icon} />
              </Button>
            </IconButtonTooltip>
          </Row>
          <Row label="Toolbar control">
            <IconButtonTooltip label="Refresh">
              <Button aria-label="Refresh" size="icon" variant="toolbar">
                <Icon aria-hidden icon={Refresh01Icon} />
              </Button>
            </IconButtonTooltip>
          </Row>
          <Row label="Multiline copy action">
            <div className="flex w-64 max-w-full">
              <Button
                fullWidth
                onClick={() => {
                  void copySampleKey();
                }}
                size="auto"
                variant="outline"
              >
                <code className="font-mono text-caption break-all">
                  example_key_for_documentation_only_not_a_real_credential
                </code>
              </Button>
            </div>
          </Row>
          <Row label="Disabled">
            <Button disabled type="button">
              Primary
            </Button>
            <Button disabled type="button" variant="outline">
              Outline
            </Button>
          </Row>
          <Row label="Full width">
            <div className="flex w-64 flex-col gap-2">
              <Button fullWidth size="sm">
                Small action
              </Button>
              <Button fullWidth>Default action</Button>
              <LinkButton fullWidth to="/design-system" variant="outline">
                Link action
              </LinkButton>
            </div>
          </Row>
          <Row label="Full-width footers">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>
                Open dialog
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Changes saved</DialogTitle>
                  <DialogDescription>
                    Your preferences are up to date.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogCloseButton variant="default">Done</DialogCloseButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="outline" />}>
                Open alert
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Setup complete</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your inbox is ready to use.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCloseButton variant="default">
                    Got it
                  </AlertDialogCloseButton>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Drawer direction="right">
              <DrawerTrigger asChild>
                <Button variant="outline">Open drawer</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Changes saved</DrawerTitle>
                  <DrawerDescription>
                    Your preferences are up to date.
                  </DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <DrawerCloseButton variant="default">Done</DrawerCloseButton>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </Row>
          <Row label="Paired footer actions">
            <div className="w-80">
              <ActionFooter>
                <Button variant="secondary">Cancel</Button>
                <Button>Apply</Button>
              </ActionFooter>
            </div>
          </Row>
          <Row label="Three footer actions">
            <div className="w-80">
              <ActionFooter>
                <Button variant="secondary">Cancel</Button>
                <Button variant="destructive">Delete</Button>
                <Button>Save</Button>
              </ActionFooter>
            </div>
          </Row>
        </Section>

        <Section title="Motion and disclosures">
          <Row label="Menu and submenu">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                Open menu
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>Mark as read</DropdownMenuItem>
                <DropdownMenuCheckboxItem defaultChecked>
                  Show previews
                </DropdownMenuCheckboxItem>
                <DropdownMenuSubmenu>
                  <DropdownMenuSubmenuTrigger>
                    Move to
                  </DropdownMenuSubmenuTrigger>
                  <DropdownMenuSubmenuContent>
                    <DropdownMenuItem>Inbox</DropdownMenuItem>
                    <DropdownMenuItem>Archive</DropdownMenuItem>
                  </DropdownMenuSubmenuContent>
                </DropdownMenuSubmenu>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
          <Row label="Content entrances">
            <Button
              onClick={() => {
                setEntrancePreview((current) => current + 1);
              }}
              variant="secondary"
            >
              Replay entrances
            </Button>
            <div className="flex items-center gap-3" key={entrancePreview}>
              <div className={entranceMotionVariants()}>
                <Pill>Fade</Pill>
              </div>
              <div className={entranceMotionVariants({ effect: "pop" })}>
                <Pill>Pop</Pill>
              </div>
              <div className={entranceMotionVariants({ effect: "slide" })}>
                <Pill>Slide</Pill>
              </div>
            </div>
          </Row>
          <Row label="Revealed field">
            <Field className="w-64 max-w-full" key={entrancePreview} reveal>
              <FieldLabel htmlFor="revealed-field">Event location</FieldLabel>
              <Input id="revealed-field" placeholder="Add a location" />
            </Field>
          </Row>
          <Row label="Delivery disclosure">
            <Accordion className="w-80 max-w-full">
              <AccordionItem value="delivery">
                <AccordionHeader>
                  <AccordionTrigger>Delivery details</AccordionTrigger>
                </AccordionHeader>
                <AccordionPanel>
                  The recipient accepted this sample message.
                </AccordionPanel>
              </AccordionItem>
              <AccordionItem value="attachment">
                <AccordionHeader>
                  <AccordionTrigger
                    indicator={<Icon aria-hidden icon={FileAttachmentIcon} />}
                  >
                    Attachment details
                  </AccordionTrigger>
                </AccordionHeader>
                <AccordionPanel>
                  One sample attachment is included.
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          </Row>
          <Row label="Technical disclosure">
            <Collapsible>
              <CollapsibleTrigger render={<Button variant="secondary" />}>
                Show technical details
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="min-h-0 overflow-hidden">
                  <Text as="p" className="mt-2" size="sm" tone="muted">
                    This sample message was delivered successfully.
                  </Text>
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </Row>
        </Section>

        <Section title="Form controls">
          <Row label="Autocomplete">
            <Autocomplete
              aria-label="Example location"
              value={location}
              onValueChange={setLocation}
              options={["Studio", "Boardroom"]}
              placeholder="Add a location"
            />
          </Row>
          <Row label="Date and time">
            <div className="flex gap-2">
              <DatePicker
                aria-label="Example date"
                value={date}
                onValueChange={setDate}
              />
              <TimePicker
                aria-label="Example time"
                value={time}
                onValueChange={setTime}
              />
            </div>
          </Row>
          <Row label="Date and time, quiet">
            <div className="flex gap-2">
              <DatePicker
                chrome="ghost"
                aria-label="Quiet example date"
                value={date}
                onValueChange={setDate}
              />
              <TimePicker
                chrome="ghost"
                aria-label="Quiet example time"
                value={time}
                onValueChange={setTime}
              />
            </div>
          </Row>
          <Row label="Input">
            <Input
              aria-label="Default input"
              className="w-64"
              placeholder="Placeholder"
            />
          </Row>
          <Row label="Input, small">
            <Input
              aria-label="Small input"
              className="w-64"
              placeholder="Search settings"
              size="sm"
            />
          </Row>
          <Row label="Inline name">
            <div className="w-64">
              {inlineNameDraft === null ? (
                <Button
                  aria-label="Edit example name"
                  className="w-full"
                  onClick={() => {
                    setInlineNameDraft(inlineName);
                  }}
                  variant="inline-edit"
                >
                  <span className="truncate">{inlineName}</span>
                </Button>
              ) : (
                <Input
                  aria-label="Example name"
                  chrome="inline"
                  onBlur={() => {
                    setInlineName(inlineNameDraft.trim() || inlineName);
                    setInlineNameDraft(null);
                  }}
                  onChange={(event) => {
                    setInlineNameDraft(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) {
                      return;
                    }
                    if (event.key === "Escape") {
                      setInlineNameDraft(null);
                    } else if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  ref={focusNameInput}
                  value={inlineNameDraft}
                />
              )}
            </div>
          </Row>
          <Row label="Color picker">
            <MailboxColorPicker
              label="Example color"
              onChange={setLabelColor}
              value={labelColor}
            />
            <MailboxColorPicker
              label="Edit example color"
              onChange={setLabelColor}
              trigger="swatch"
              value={labelColor}
            />
          </Row>
          <Row label="Search input">
            <InputGroup className="w-64">
              <InputAddon
                aria-hidden
                className="ml-3 flex shrink-0 items-center"
              >
                <Icon icon={Search01Icon} size={14} tone="muted" />
              </InputAddon>
              <Input
                aria-label="Search samples"
                chrome="attached"
                placeholder="Search"
              />
            </InputGroup>
          </Row>
          <Row label="Borderless input">
            <Input
              aria-label="Example borderless input"
              chrome="ghost"
              className="w-64"
              placeholder="Focus to edit"
            />
            <Input
              aria-label="Example borderless title"
              chrome="ghost"
              className="w-64"
              defaultValue="Event title"
              size="lg"
            />
          </Row>
          <Row label="Input, invalid">
            <Input
              aria-invalid
              aria-label="Invalid input"
              className="w-64"
              defaultValue="Not an email"
            />
          </Row>
          <Row label="Compound address">
            <InputGroup className="w-80 max-w-full">
              <Input
                aria-label="Mailbox name"
                chrome="attached"
                defaultValue="support"
              />
              <InputAddon aria-hidden>@</InputAddon>
              <Select defaultValue="example.test">
                <SelectTrigger aria-label="Mailbox domain" variant="attached">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    <SelectItem value="example.test">example.test</SelectItem>
                    <SelectItem value="studio.test">studio.test</SelectItem>
                  </SelectList>
                </SelectContent>
              </Select>
            </InputGroup>
          </Row>
          <Row label="Searchable choice">
            <CalendarTimeZonePicker
              aria-label="Sample time zone"
              className="w-64 max-w-full"
              onValueChange={setTimeZone}
              value={timeZone}
            />
          </Row>
          <Row label="Searchable toolbar choice">
            <CalendarTimeZonePicker
              aria-label="Sample toolbar time zone"
              className="max-w-40"
              onValueChange={setTimeZone}
              size="sm"
              value={timeZone}
              variant="ghost"
            />
          </Row>
          <Row label="Searchable choice, disabled">
            <CalendarTimeZonePicker
              aria-label="Disabled sample time zone"
              className="w-64 max-w-full"
              disabled
              onValueChange={setTimeZone}
              value={timeZone}
            />
          </Row>
          <Row label="Compact notes">
            <Textarea
              variant="compact-prompt"
              rows={1}
              aria-label="Compact notes"
              placeholder="Add a description"
            />
          </Row>
          <Row label="Textarea">
            <Textarea
              aria-label="Message"
              className="w-64"
              placeholder="Placeholder"
            />
          </Row>
          <Row label="Growing textarea">
            <Textarea
              aria-label="Example growing prompt"
              autoSize
              className="w-80 max-w-full"
              placeholder="Describe which emails belong here…"
            />
          </Row>
          <Row label="Prompt composer">
            <PromptComposerFrame className="w-80 max-w-full">
              {showPromptContext ? (
                <div className="flex min-w-0">
                  <ComposerContextChip
                    icon={<Icon aria-hidden size={12} icon={Mail01Icon} />}
                    label="Planning the autumn release"
                    onRemove={() => {
                      setShowPromptContext(false);
                    }}
                  />
                </div>
              ) : null}
              <Textarea
                aria-label="Example assistant message"
                placeholder="Ask about your mail…"
                variant="prompt"
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  onClick={() => {
                    setShowPromptContext(true);
                  }}
                  size="compact"
                  variant="ghost"
                >
                  Attach mail
                </Button>
                <Button size="compact">Send</Button>
              </div>
            </PromptComposerFrame>
          </Row>
          <Row label="Composer actions">
            <ComposerActionBar className="w-80 max-w-full">
              <Button className="min-w-0 flex-1" size="auto" variant="ghost">
                <Icon aria-hidden icon={Mail01Icon} />
                <Text as="span" size="sm" tone="muted" truncate>
                  Reply to Alex
                </Text>
              </Button>
              <Button size="sm" variant="ghost">
                Forward
              </Button>
            </ComposerActionBar>
          </Row>
          <Row label="Token field">
            <div className="w-80 rounded-md border border-border bg-input px-3 py-2 shadow-sm squircle focus-within:border-ring focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-bg-raised">
              <TokenField
                aria-label="Token field"
                onChange={setTokenFieldValue}
                placeholder="Type @ to mention an app…"
                size="prompt"
                tokens={showcaseTokens}
                value={tokenFieldValue}
              />
            </div>
          </Row>
          <Row label="Field with label">
            <Field className="w-64">
              <FieldLabel htmlFor="showcase-field">Email address</FieldLabel>
              <Input id="showcase-field" placeholder="you@example.com" />
              <FieldDescription>
                Visible labels, not placeholders.
              </FieldDescription>
            </Field>
          </Row>
          <Row label="Switch, default">
            <Switch checked={checked} onCheckedChange={setChecked}>
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Switch, sm">
            <Switch checked={checked} onCheckedChange={setChecked} size="sm">
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Switch, pending">
            <Switch checked pending size="sm">
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Switch, disabled">
            <Switch checked disabled size="sm">
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Checkbox">
            <Checkbox checked={boxChecked} onCheckedChange={setBoxChecked}>
              <CheckboxIndicator />
            </Checkbox>
          </Row>
        </Section>

        <Section
          description="Categorical colors describe labels and roles. Semantic tones describe status."
          title="Pills"
        >
          <div className="flex flex-wrap gap-2">
            {pillTones.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </div>
          <Row label="Status">
            {statusTones.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </Row>
          <Row label="Sizes">
            <Pill tone="blue">Default</Pill>
            <Pill size="xs" tone="blue">
              Compact
            </Pill>
          </Row>
        </Section>

        <Section
          description="Settings wrappers add domain behavior and anchors. Shared layouts own the spacing, type, borders, and row treatments."
          title="Settings layouts"
        >
          <div className="space-y-6">
            <SettingsPageHeader title="Preferences">
              Choose how your inbox works for you.
            </SettingsPageHeader>
            <SettingsSectionLayout title="Reading">
              <SettingsCard>
                <SettingsFieldRow
                  action={
                    <Switch
                      aria-label="Show message previews"
                      checked={checked}
                      onCheckedChange={setChecked}
                    >
                      <SwitchThumb />
                    </Switch>
                  }
                  label="Message previews"
                  value="Show a short preview beside each subject."
                />
                <SettingsNavigationRow
                  description="Choose who can use this mailbox."
                  onClick={() => {
                    setSettingsDialogOpen(true);
                  }}
                  title="Mailbox access"
                />
              </SettingsCard>
            </SettingsSectionLayout>
          </div>
          <Dialog
            open={settingsDialogOpen}
            onOpenChange={setSettingsDialogOpen}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mailbox access</DialogTitle>
                <DialogDescription>
                  This example uses the same settings row and dialog as the
                  product.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogCloseButton variant="default">Done</DialogCloseButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Row label="Setup choices">
            <div className="grid w-full gap-3 @md:grid-cols-2">
              <Button variant="card">
                <span className="text-body font-medium">Connect a mailbox</span>
                <span className="text-body-sm text-muted-fg">
                  Use an existing email account.
                </span>
              </Button>
              <Button variant="card">
                <span className="text-body font-medium">Use your domain</span>
                <span className="text-body-sm text-muted-fg">
                  Create a managed mailbox.
                </span>
              </Button>
            </div>
          </Row>
        </Section>

        <Section
          description="A shared schedule with overlapping events, all-day rows, keyboard navigation, drag and resize. This example uses sample events."
          title="Schedule"
        >
          <ScheduleShowcase />
        </Section>

        <Section title="Mobile header">
          <div className="overflow-hidden rounded-md border border-border squircle">
            <MobileHeader
              className="flex"
              leading="sidebar"
              onLeadingClick={() => {
                // Static preview; the product wires this to the drawer.
              }}
              title="New message"
            />
            <MobileHeader
              className="flex"
              leading="back"
              onLeadingClick={() => {
                // Static preview; the product wires this to the drawer.
              }}
            />
          </div>
          <p className="mt-2 text-micro text-muted-fg">
            Forced visible here; in the product it is `lg:hidden`.
          </p>
        </Section>

        <Section
          description="One mark, one statement, one optional next action. Holds still under reduced motion."
          title="Empty state"
        >
          <div className="flex min-h-64 rounded-md border border-border squircle">
            <EmptyMessageState
              action={
                <Button size="sm" type="button" variant="outline">
                  Start a new message
                </Button>
              }
            />
          </div>
        </Section>
      </div>
    </main>
  );
};
