-- docs/22 §4: a vote cast with Discord's buttons is the member's vote on the site. The site says where it came from
-- ("You voted in Discord"), so nobody votes twice. Earlier votes take it from their latest poll.vote event.

-- AlterTable
ALTER TABLE "PollAnswer" ADD COLUMN "via" TEXT NOT NULL DEFAULT 'site';

UPDATE "PollAnswer" a SET "via" = 'discord'
WHERE (
  SELECT e."meta"->'params'->>'via'
  FROM "Event" e
  WHERE e."meta"->>'action' = 'poll.vote'
    AND e."meta"->'params'->>'pollId' = a."pollId"
    AND e."actor" = a."userId"
  ORDER BY e."at" DESC
  LIMIT 1
) = 'discord';
