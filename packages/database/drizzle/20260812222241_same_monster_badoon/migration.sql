ALTER TABLE "user" ADD COLUMN "onboardingCompletedAt" timestamp;--> statement-breakpoint
-- Onboarding is new: anyone who already accepted the Terms has been using the
-- product, so treat them as onboarded rather than sending them through it.
UPDATE "user"
SET "onboardingCompletedAt" = "termsAcceptedAt"
WHERE "termsAcceptedAt" IS NOT NULL;
