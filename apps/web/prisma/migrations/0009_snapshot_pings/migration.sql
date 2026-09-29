-- docs/05 "Connection": each player's ping at the time of the snapshot, {"<uuid>": <milliseconds>}.

-- AlterTable
ALTER TABLE "ServerSnapshot" ADD COLUMN "pings" JSONB;
