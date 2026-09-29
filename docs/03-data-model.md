# 03 · Data model

Prisma schema, described. Keep it this small; add columns when a phase needs them.

```prisma
model User {
  id            String   @id @default(cuid())
  displayName   String
  role          Role     @default(PLAYER)      // ADMIN | PLAYER
  discordId     String?  @unique
  email         String?  @unique               // only for credentials fallback
  passwordHash  String?                        // only for credentials fallback
  mcUsername    String?  @unique               // Minecraft Java username, set by the player
  mcUuid        String?  @unique               // resolved from Mojang API when mcUsername is set
  pcTier        PcTier?                        // LOW | MID | HIGH, self-reported, drives warnings
  createdAt     DateTime @default(now())
  lastSeenAt    DateTime?
  invitedById   String?
  ballots       Ballot[]
  auditLogs     AuditLog[]
}

model Invite {
  code       String   @id                       // 8 chars, human-readable
  createdBy  String
  usedBy     String?  @unique
  expiresAt  DateTime
  note       String?                            // "for Bertie"
}

model Vote {
  id        String     @id @default(cuid())
  title     String                              // "Season 1 mods"
  status    VoteStatus @default(DRAFT)          // DRAFT | OPEN | CLOSED
  opensAt   DateTime?
  closesAt  DateTime?
  questions Json                                // [{id, text, options[]}] settings questions
  ballots   Ballot[]
  resultJson Json?                              // frozen tally when CLOSED
}

model Ballot {
  id        String   @id @default(cuid())
  voteId    String
  userId    String
  modIds    String[]                            // slugs from mods.json
  answers   Json                                // {questionId: option}
  submittedAt DateTime @updatedAt
  @@unique([voteId, userId])                    // one ballot per person, editable until close
}

model Announcement {
  id        String   @id @default(cuid())
  body      String
  pinned    Boolean  @default(false)
  createdAt DateTime @default(now())
  authorId  String
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  action    String                              // "whitelist.addSelf", "server.restart"
  params    Json
  result    String                              // OK | DENIED | FAILED | TIMEOUT
  detail    String?                             // console line or error
  createdAt DateTime @default(now())
}

model ServerSnapshot {                          // one row per poll, pruned to 7 days
  id        Int      @id @default(autoincrement())
  at        DateTime @default(now())
  state     String                              // Running | Stopped | Starting...
  players   String[]
  tps       Float?
  cpu       Float?
  memMb     Int?
}
```

## Added by docs/16 (2026-09-29)

`Session` (one row per visit to the Minecraft server), `Event` (the event log; replaces `AuditLog`) and `Setting` (key/value settings edited from the admin pages). The definitions are in `apps/web/prisma/schema.prisma`; docs/16 §1 has the reasoning. `ServerSnapshot` is kept for 30 days and thinned to one row per five minutes after 48 hours.

## Not in the database

- **Mods.** They live in `modpack/mods.json` and `mods.lock.json`. The app reads the files at startup and on a file-change signal (or on each request in dev). Ballots reference mods by slug so a mod removed from the manifest still shows up in old results as "removed".
- **Map data.** BlueMap owns it.
- **Player inventories, homes, stats.** Read live from the server when a feature needs them; don't mirror.

## Roles and permissions

Two roles, checked in `src/server/auth/can.ts`:

| Permission | PLAYER | ADMIN |
|---|---|---|
| view catalogue, dashboard, map | ✓ | ✓ |
| submit/edit own ballot while OPEN | ✓ | ✓ |
| set own mcUsername, pcTier | ✓ | ✓ |
| player actions on self (whitelist, home, spawn) | ✓ (rate limited) | ✓ |
| create/open/close votes | | ✓ |
| invites, user list, role changes | | ✓ |
| server start/stop/restart, announcements | | ✓ |
| toggle mods, trigger lock/build/sync | | ✓ |
| read audit log | | ✓ |
