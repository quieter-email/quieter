import {
  Alert02Icon,
  Calendar03Icon,
  Edit02Icon,
  Link01Icon,
  Loading03Icon,
  Mail01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { linearToolCallInputSchema } from "@quieter/ai/chat-agent";
import { MailReference } from "@quieter/app/features/chat/components/mail-reference";
import { humanizeToolName } from "@quieter/app/features/chat/domain/chat-tools";
import { formatActivityTime } from "@quieter/app/features/chat/domain/tool-activity";
import type {
  ChatActivitySegment,
  ExceptionalActivity,
  RoutineActivity,
} from "@quieter/app/features/chat/domain/tool-activity";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import { Icon } from "@quieter/ui/icon";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";

const categoryIcons = {
  calendar: Calendar03Icon,
  connection: Link01Icon,
  draft: Edit02Icon,
  mail: Mail01Icon,
  search: Search01Icon,
  workspace: Mail01Icon,
};

const ActivityApproval = ({
  activity,
  isStreaming,
}: {
  activity: Extract<ExceptionalActivity, { kind: "approval" }>;
  isStreaming: boolean;
}) => {
  const { approval } = activity;
  const review = approval?.calendarReview;
  const account = approval?.connectorReview ?? approval?.linearReview;
  const command = linearToolCallInputSchema.safeParse(activity.input);
  const canReview = review !== undefined || account !== undefined;
  const details: [string, string][] = [];
  let consequence =
    "Review this change before continuing. It may permanently remove content.";
  if (review) {
    details.push(
      ["When", formatActivityTime(review.time)],
      ["Account", review.account.email ?? review.account.name],
      ["Calendar", review.calendar.name],
      [
        "Applies to",
        {
          event: "This event",
          occurrence: "This occurrence only",
          series: "The entire series",
        }[review.scope],
      ]
    );
    consequence = {
      event: "This permanently removes the event. Guests will be notified.",
      occurrence:
        "This permanently removes this occurrence. Guests will be notified.",
      series:
        "This permanently removes every occurrence in the series. Guests will be notified.",
    }[review.scope];
  } else if (command.success) {
    for (const [key, value] of Object.entries(command.data.arguments)) {
      const target = /(?:^id$|Id$|_id$|^item$|^target$|^path$)/u.test(key);
      if (
        typeof value === "string" &&
        (target ||
          ["title", "name", "identifier", "content", "reason"].includes(key))
      ) {
        const label =
          humanizeToolName(
            key
              .replaceAll(/(?<=[a-z\d])(?=[A-Z])/gu, " ")
              .replace(/(?:[_\s-]?id)$/iu, "")
          ) || "Affected item";
        details.push([target ? label : humanizeToolName(key), value]);
      }
    }
  }

  return (
    <Surface className="my-3">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <Icon
            icon={review ? Calendar03Icon : Alert02Icon}
            size={18}
            tone="destructive"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <Text size="body" weight="medium">
              {activity.title}
            </Text>
            <Text size="sm" tone="muted">
              {consequence}
            </Text>
          </div>
        </div>
        {account ? (
          <Text className="wrap-anywhere" size="sm" tone="muted">
            {[account.account, account.workspace].filter(Boolean).join(", ")}
          </Text>
        ) : null}
        {details.length > 0 ? (
          <dl className="space-y-2">
            {details.map(([label, value]) => (
              <div className="space-y-0.5" key={`${label}:${value}`}>
                <dt className="text-caption text-muted-fg">{label}</dt>
                <dd className="text-body-sm wrap-anywhere whitespace-pre-wrap text-fg">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {canReview ? null : (
          <Text size="sm" tone="muted">
            The destination and affected item need to be checked before this
            action can be confirmed.
          </Text>
        )}
        {review ? null : (
          <Collapsible>
            <CollapsibleTrigger variant="text">
              Full action details
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="min-h-0 overflow-hidden">
                <pre className="mt-2 max-h-64 overflow-auto text-caption wrap-anywhere whitespace-pre-wrap text-muted-fg">
                  <code>{JSON.stringify(activity.input, null, 2)}</code>
                </pre>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        )}
        {approval ? (
          <ActionFooter>
            <Button
              disabled={isStreaming}
              onClick={() => {
                approval.deny();
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={isStreaming || !canReview}
              onClick={() => {
                approval.approve();
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              {review ? "Delete event" : "Confirm"}
            </Button>
          </ActionFooter>
        ) : null}
      </div>
    </Surface>
  );
};

export const ToolActivity = ({
  activity,
  isStreaming,
}: {
  activity: Exclude<ChatActivitySegment, { kind: "text" }>;
  isStreaming: boolean;
}) => {
  if (activity.kind === "approval") {
    return <ActivityApproval activity={activity} isStreaming={isStreaming} />;
  }
  if (activity.kind === "failure") {
    return (
      <div aria-live="polite" className="flex items-start gap-2">
        <Icon
          aria-hidden
          className="mt-0.5"
          icon={Alert02Icon}
          tone="destructive"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <Text size="sm" tone="destructive">
            {activity.title}
          </Text>
          <Text className="wrap-anywhere" size="caption" tone="muted">
            {activity.message}
          </Text>
          {activity.sources.length > 0 ? (
            <div className="flex min-w-0 flex-col items-start">
              {activity.sources.slice(0, 3).map((source) => (
                <MailReference inline key={source.messageId} reference={source}>
                  Open email
                </MailReference>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const { steps } = activity;
  const current =
    steps.findLast((step) => step.phase === "running") ??
    steps.findLast((step) => step.phase === "complete") ??
    steps[0];
  const sourcesById = new Map<string, RoutineActivity["sources"][number]>();
  for (const source of steps.flatMap((step) => step.sources)) {
    const previous = sourcesById.get(source.messageId);
    sourcesById.set(source.messageId, {
      ...previous,
      ...source,
      from: source.from?.trim() || previous?.from,
      subject: source.subject?.trim() || previous?.subject,
    });
  }
  const sources = [...sourcesById.values()];
  const detailSteps = steps.filter(
    (step) => step !== current || step.context.length > 0
  );
  const icon =
    current.phase === "running"
      ? Loading03Icon
      : categoryIcons[current.category];

  if (detailSteps.length === 0 && sources.length === 0) {
    return (
      <output className="flex min-h-6 items-center gap-2">
        <Icon
          aria-hidden
          animation={current.phase === "running" ? "spin" : undefined}
          icon={icon}
          tone="muted"
        />
        <Text as="span" size="sm" tone="muted">
          {current.title}
        </Text>
      </output>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="max-w-full" variant="text">
        <Icon
          aria-hidden
          animation={current.phase === "running" ? "spin" : undefined}
          icon={icon}
        />
        <span aria-live="polite" className="truncate">
          {current.title}
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel keepMounted={false}>
        <div className="min-h-0 space-y-2 py-1">
          {detailSteps.length > 0 ? (
            <ol className="space-y-1.5">
              {detailSteps.map((step) => (
                <li
                  className={cn("flex items-start gap-2", {
                    "ps-6": step === current,
                  })}
                  key={step.id}
                >
                  {step === current ? null : (
                    <Icon
                      aria-hidden
                      animation={step.phase === "running" ? "spin" : undefined}
                      className="mt-0.5"
                      icon={
                        step.phase === "running"
                          ? Loading03Icon
                          : categoryIcons[step.category]
                      }
                      tone="muted"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {step === current ? null : (
                        <Text as="span" size="sm">
                          {step.title}
                        </Text>
                      )}
                      {step.context.length === 1 ? (
                        <Text
                          as="span"
                          className="wrap-anywhere"
                          size="caption"
                          tone="muted"
                        >
                          {step.context[0]}
                        </Text>
                      ) : null}
                    </div>
                    {step.context.length > 1
                      ? step.context.map((context) => (
                          <Text
                            className="wrap-anywhere"
                            key={context}
                            size="caption"
                            tone="muted"
                          >
                            {context}
                          </Text>
                        ))
                      : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {sources.length > 0 ? (
            <div className="flex min-w-0 flex-col items-start ps-6">
              <ul className="w-full">
                {sources.slice(0, 3).map((source) => (
                  <li key={source.messageId}>
                    <MailReference inline reference={source}>
                      Open email
                    </MailReference>
                  </li>
                ))}
              </ul>
              {sources.length > 3 ? (
                <Text size="caption" tone="muted">
                  {sources.length - 3} more emails in these results.
                </Text>
              ) : null}
            </div>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
