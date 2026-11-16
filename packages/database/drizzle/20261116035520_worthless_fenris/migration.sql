CREATE TABLE "calendarBookingLink" (
	"createdAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"revokedAt" timestamp with time zone,
	"scope" jsonb NOT NULL,
	"title" text NOT NULL,
	"tokenHash" text NOT NULL CONSTRAINT "calendar_booking_link_token_unique" UNIQUE,
	"updatedAt" timestamp with time zone NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "calendar_booking_link_owner_unique" UNIQUE("id","userId"),
	CONSTRAINT "calendar_booking_link_token_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "calendar_booking_link_scope_check" CHECK (jsonb_typeof("scope") = 'object'),
	CONSTRAINT "calendar_booking_link_title_check" CHECK (length(btrim("title")) > 0 and length("title") <= 120),
	CONSTRAINT "calendar_booking_link_time_check" CHECK ("expiresAt" > "createdAt"
        and "updatedAt" >= "createdAt"
        and ("revokedAt" is null or "revokedAt" >= "createdAt"))
);
--> statement-breakpoint
CREATE TABLE "calendarBookingReservation" (
	"busyEnd" timestamp with time zone NOT NULL,
	"busyStart" timestamp with time zone NOT NULL,
	"confirmedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"effectStartedAt" timestamp with time zone,
	"end" timestamp with time zone NOT NULL,
	"eventId" text,
	"id" text PRIMARY KEY,
	"leaseToken" text,
	"leaseUntil" timestamp with time zone,
	"linkId" text NOT NULL,
	"requestHash" text NOT NULL,
	"requestId" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "calendar_booking_reservation_request_unique" UNIQUE("linkId","requestId"),
	CONSTRAINT "calendar_booking_reservation_request_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$'
        and length(btrim("requestId")) > 0
        and length("requestId") <= 255),
	CONSTRAINT "calendar_booking_reservation_bounds_check" CHECK ("start" < "end"
        and "busyStart" <= "start"
        and "busyEnd" >= "end"),
	CONSTRAINT "calendar_booking_reservation_time_check" CHECK ("updatedAt" >= "createdAt"
        and ("leaseUntil" is null or "leaseUntil" > "createdAt")
        and ("effectStartedAt" is null or "effectStartedAt" >= "createdAt")
        and ("confirmedAt" is null or "confirmedAt" >= "effectStartedAt")),
	CONSTRAINT "calendar_booking_reservation_state_check" CHECK ((
        "status" = 'reserved'
        and "leaseToken" is not null and length(btrim("leaseToken")) > 0
        and "leaseUntil" is not null
        and "effectStartedAt" is null and "confirmedAt" is null
        and "eventId" is null
      ) or (
        "status" in ('creating', 'uncertain')
        and "leaseToken" is null and "leaseUntil" is null
        and "effectStartedAt" is not null and "confirmedAt" is null
      ) or (
        "status" = 'confirmed'
        and "leaseToken" is null and "leaseUntil" is null
        and "effectStartedAt" is not null and "confirmedAt" is not null
        and "eventId" is not null and length(btrim("eventId")) > 0
      ) or (
        "status" in ('failed', 'cancelled')
        and "leaseToken" is null and "leaseUntil" is null
        and "effectStartedAt" is null and "confirmedAt" is null
        and "eventId" is null
      ))
);
--> statement-breakpoint
CREATE INDEX "calendar_booking_link_owner_created_idx" ON "calendarBookingLink" ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "calendar_booking_link_expiry_idx" ON "calendarBookingLink" ("expiresAt");--> statement-breakpoint
CREATE INDEX "calendar_booking_reservation_owner_busy_idx" ON "calendarBookingReservation" ("userId","status","busyStart","busyEnd");--> statement-breakpoint
CREATE INDEX "calendar_booking_reservation_link_created_idx" ON "calendarBookingReservation" ("linkId","createdAt");--> statement-breakpoint
ALTER TABLE "calendarBookingLink" ADD CONSTRAINT "calendarBookingLink_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calendarBookingReservation" ADD CONSTRAINT "calendarBookingReservation_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calendarBookingReservation" ADD CONSTRAINT "calendar_booking_reservation_link_owner_fk" FOREIGN KEY ("linkId","userId") REFERENCES "calendarBookingLink"("id","userId");