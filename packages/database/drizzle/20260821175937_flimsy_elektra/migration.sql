-- quieter:contract
-- Chat resume snapshots were replaced by approval state stored in message parts.
-- Chat data is disposable; the column is dropped in the same release that stops writing it.
ALTER TABLE "chatMessage" DROP COLUMN "resume";
