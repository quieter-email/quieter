CREATE TABLE "mailAdmissionGate" (
	"id" integer PRIMARY KEY,
	CONSTRAINT "mail_admission_single_gate" CHECK ("id" = 1)
);
