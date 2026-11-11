import type { DatabaseClient } from "@quieter/database/client";
import {
  billingCreditUsageEvent,
  billingSubscription,
  mailbox,
  organizationMailUsageEvent,
  user,
  waitlistSignup,
} from "@quieter/database/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";

const nonnegativeCount = z.number().int().nonnegative();

const dailyMetricsSchema = z.object({
  aiUsageCredits: z.number().nonnegative(),
  aiUsageEvents: nonnegativeCount,
  date: z.iso.date(),
  managedInboundMessages: nonnegativeCount,
  managedOutboundRecipients: nonnegativeCount,
  newUsers: nonnegativeCount,
  waitlistSignups: nonnegativeCount,
});

const currentMetricsSchema = z.object({
  completedOnboardingUsers: nonnegativeCount,
  connectedMailboxes: nonnegativeCount,
  gmailMailboxes: nonnegativeCount,
  managedPrivateMailboxes: nonnegativeCount,
  managedSharedMailboxes: nonnegativeCount,
  managedSubscriptions: nonnegativeCount,
  proSubscriptions: nonnegativeCount,
  totalUsers: nonnegativeCount,
});

export const getOperationsOverview = async ({
  db,
  days,
}: {
  db: DatabaseClient;
  days: 7 | 30 | 90;
}) => {
  const now = new Date();
  const asOf = now.toISOString();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const [dailyRows, currentRows] = await Promise.all([
    db.execute(sql`
      with bounds as (
        select ${start.toISOString()}::timestamp without time zone as utc_start_at,
               ${asOf}::timestamp without time zone as utc_as_of
      ), signups as (
        select date_trunc('day', ${user.createdAt}) as day, count(*) as users
        from ${user}, bounds
        where ${user.createdAt} >= bounds.utc_start_at and ${user.createdAt} < bounds.utc_as_of
        group by 1
      ), waitlist as (
        select date_trunc('day', ${waitlistSignup.createdAt}) as day, count(*) as signups
        from ${waitlistSignup}, bounds
        where ${waitlistSignup.createdAt} >= bounds.utc_start_at
          and ${waitlistSignup.createdAt} < bounds.utc_as_of
        group by 1
      ), ai_usage as (
        select date_trunc('day', ${billingCreditUsageEvent.createdAt}) as day,
               count(*) as events,
               sum(${billingCreditUsageEvent.costMicroCents}) / 1000000 as credits
        from ${billingCreditUsageEvent}, bounds
        where ${billingCreditUsageEvent.category} = 'ai'
          and ${billingCreditUsageEvent.createdAt} >= bounds.utc_start_at
          and ${billingCreditUsageEvent.createdAt} < bounds.utc_as_of
        group by 1
      ), managed_mail as (
        select date_trunc('day', ${organizationMailUsageEvent.createdAt}) as day,
               sum(${organizationMailUsageEvent.messageCount})
                 filter (where ${organizationMailUsageEvent.direction} = 'inbound') as inbound,
               sum(${organizationMailUsageEvent.messageCount})
                 filter (where ${organizationMailUsageEvent.direction} = 'outbound') as outbound
        from ${organizationMailUsageEvent}, bounds
        where ${organizationMailUsageEvent.createdAt} >= bounds.utc_start_at
          and ${organizationMailUsageEvent.createdAt} < bounds.utc_as_of
        group by 1
      )
      select to_char(calendar.day, 'YYYY-MM-DD') as "date",
             coalesce(signups.users, 0)::double precision as "newUsers",
             coalesce(waitlist.signups, 0)::double precision as "waitlistSignups",
             coalesce(ai_usage.events, 0)::double precision as "aiUsageEvents",
             coalesce(ai_usage.credits, 0)::double precision as "aiUsageCredits",
             coalesce(managed_mail.inbound, 0)::double precision as "managedInboundMessages",
             coalesce(managed_mail.outbound, 0)::double precision as "managedOutboundRecipients"
      from bounds
      cross join lateral generate_series(bounds.utc_start_at, bounds.utc_as_of, interval '1 day') as calendar(day)
      left join signups using (day)
      left join waitlist using (day)
      left join ai_usage using (day)
      left join managed_mail using (day)
      order by calendar.day
    `),
    db.execute(sql`
      with users as (
        select count(*)::double precision as "totalUsers",
               (count(*) filter (where ${user.onboardingCompletedAt} < ${asOf}::timestamp))::double precision
                 as "completedOnboardingUsers"
        from ${user}
        where ${user.createdAt} < ${asOf}::timestamp
      ), subscriptions as (
        select (count(*) filter (where ${billingSubscription.plan} = 'pro'))::double precision
                 as "proSubscriptions",
               (count(*) filter (where ${billingSubscription.plan} = 'managed'))::double precision
                 as "managedSubscriptions"
        from ${billingSubscription}
        where ${billingSubscription.status} in ('active', 'trialing')
      ), mailboxes as (
        select (count(*) filter (where ${mailbox.status} = 'connected'))::double precision
                 as "connectedMailboxes",
               (count(*) filter (where ${mailbox.provider} = 'gmail'))::double precision
                 as "gmailMailboxes",
               (count(*) filter (where ${mailbox.provider} = 'managed' and ${mailbox.accessMode} = 'private'))::double precision
                 as "managedPrivateMailboxes",
               (count(*) filter (where ${mailbox.provider} = 'managed' and ${mailbox.accessMode} = 'shared'))::double precision
                 as "managedSharedMailboxes"
        from ${mailbox}
      )
      select * from users cross join subscriptions cross join mailboxes
    `),
  ]);

  const daily = z.array(dailyMetricsSchema).parse(dailyRows);
  const current = currentMetricsSchema.parse(currentRows[0]);
  return {
    asOf,
    daily,
    kpis: {
      activeSubscriptions:
        current.proSubscriptions + current.managedSubscriptions,
      aiUsageEvents: daily.reduce((sum, point) => sum + point.aiUsageEvents, 0),
      completedOnboardingUsers: current.completedOnboardingUsers,
      connectedMailboxes: current.connectedMailboxes,
      totalUsers: current.totalUsers,
    },
    mailboxMix: {
      gmail: current.gmailMailboxes,
      managedPrivate: current.managedPrivateMailboxes,
      managedShared: current.managedSharedMailboxes,
    },
    subscriptionMix: {
      managed: current.managedSubscriptions,
      pro: current.proSubscriptions,
    },
  };
};
