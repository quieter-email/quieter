"use client";

import {
  calendarPreviewCalendars,
  createCalendarPreviewEvents,
} from "@quieter/app/features/calendar/domain/calendar-preview";
import { getCalendarSchedule } from "@quieter/app/features/calendar/domain/calendar-schedule";
import { ManagedUsageSummary } from "@quieter/app/features/settings/components/organization-settings/organization-mail-usage-settings";
import { BILLING_PRODUCTS } from "@quieter/billing/plans";
import { getManagedUsageRates } from "@quieter/billing/ses-pricing";
import { Schedule } from "@quieter/ui/schedule";
import { Text } from "@quieter/ui/text";
import { useState } from "react";

const calendarDate = "2026-11-04";
const calendarDates = ["2026-11-03", calendarDate, "2026-11-05"];
const calendarTimeZone = "Europe/Berlin";
const calendarEvents = createCalendarPreviewEvents({
  date: calendarDate,
  timeZone: calendarTimeZone,
});
const { items: calendarItems } = getCalendarSchedule({
  calendars: calendarPreviewCalendars,
  dates: calendarDates,
  events: calendarEvents,
  timeZone: calendarTimeZone,
});

export const CalendarPreview = () => {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = calendarItems.find((item) => item.id === selectedId);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex h-96 min-w-0 flex-col" data-lenis-prevent-wheel>
        <Schedule
          dates={calendarDates}
          items={calendarItems}
          onEmptyClick={() => {
            setSelectedId(undefined);
          }}
          onEventClick={setSelectedId}
          onSlotCreate={() => {
            setSelectedId(undefined);
          }}
          selectedId={selectedId}
          today={calendarDate}
          view="week"
        />
      </div>
      <Text size="caption" tone="muted">
        {selected ? (
          <>
            {selected.title}
            {selected.detail ? `, ${selected.detail}` : null}
          </>
        ) : (
          "Select an event to take a closer look."
        )}
      </Text>
    </div>
  );
};

export const BillingPreview = () => (
  <div className="@container min-w-0">
    <ManagedUsageSummary
      includedUsageCents={BILLING_PRODUCTS.pro.creditAmountCents}
      rates={getManagedUsageRates()}
      usage={{
        billableCostCents: 0,
        breakdown: [
          { costCents: 565, kind: "aiChat" },
          { costCents: 145, kind: "aiMemory" },
          { costCents: 88, kind: "importance" },
          { costCents: 112, kind: "autoLabel" },
          { costCents: 96, kind: "inboundMail" },
          { costCents: 178, kind: "outboundMail" },
        ],
        managedUsageCostCents: 1184,
      }}
    />
  </div>
);
