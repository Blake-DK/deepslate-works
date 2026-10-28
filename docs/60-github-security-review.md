# 60 · GitHub security review

> **2026-10-28:** the VPS is no longer used; the site runs at home on docker-01v, deployed by a Redeploy in Dockhand (deploy/home/README.md). VPS paths, `deploy.sh` and the tunnel below are the record of their day.

Planned 2026-10-12, nothing checked yet. docs/54 switched GitHub's security features on. This is the review of the
GitHub side as a whole: the account, the repository's settings, the workflows, the packages, what the public can read
and what the scanners have raised. It is read-only. Fixes come afterwards as their own work.

## 1. Rules

- **Read-only.** No setting, secret, branch, tag, run, artifact or package is changed or deleted during the review.
  The one exception: a secret that is still valid and found anywhere public is rotated at once by Alex, then cleaned up.
- **Findings stay private** (docs/38, "Where the open findings are"). This doc and docs/11 get the date, the rows
  checked and the counts. A row's result is written here only when it is Met.
- **Evidence is the real state:** the API's answer or what Alex reads off the settings page on the day. A workflow
  file or a doc saying so is not evidence for a setting.
- **No secret value** in a chat, a report or a doc. Names, permissions and dates only.
- **The public-repo rule** (docs/38 I8) holds for everything written about the review.
- **No token is widened for the review.** A read the VPS session's token is refused goes to Alex's list (§3).

## 2. Part A: the VPS session, read-only

`{o}/{r}` is this repository. Every endpoint is a `GET`.

### A1. Settings, by API

| Row | Endpoint | Wanted |
|---|---|---|
| A1.1 | `repos/{o}/{r}` | Public, default branch `main`, `security_and_analysis` as docs/54 §1. Wiki, discussions, Pages and forking: state noted |
| A1.2 | `repos/{o}/{r}/branches/main/protection`, `repos/{o}/{r}/rulesets` | Pull request required, `check` required, force pushes off, deletions off (I7). Noted: whether the rule binds admins, who may bypass, whether `dev` or any tag has a rule |
| A1.3 | `repos/{o}/{r}/actions/permissions`, `.../actions/permissions/workflow` | Which actions may run: noted. Default token read-only. Actions may not create or approve pull requests |
| A1.4 | `repos/{o}/{r}/actions/permissions/fork-pr-contributor-approval` | Approval needed before a workflow runs for any outside contributor |
| A1.5 | `.../actions/secrets`, `.../actions/variables`, `.../environments` and each environment's secrets and rules | Names and dates only. Every name has a row in docs/38 §6. None unused |
| A1.6 | `.../actions/runners` | No self-hosted runner |
| A1.7 | `.../keys`, `.../hooks`, `.../collaborators`, `.../invitations` | Deploy keys: none, or each known and read-only. Webhooks: each known. Collaborators: Alex only. No open invitation |
| A1.8 | `.../code-scanning/default-setup`, `.../private-vulnerability-reporting` | Not configured. Enabled |
| A1.9 | `.../actions/artifacts`, `.../actions/caches` | Listed by name, size and expiry. Retention in days noted |
| A1.10 | `.../forks`, `.../releases`, `.../tags` | Forks: who. No release carries the exe or a jar |

### A2. The workflows, read on `main` and on `dev`

The planner read the six files on `dev` on 2026-10-12: only `push`, `pull_request`, `schedule` and
`workflow_dispatch` start a run, every `uses:` is a full commit SHA with its version, every file starts from
`contents: read`. Confirm the same on `main`, then answer each row:

| Row | Question |
|---|---|
| A2.1 | A pull request from a fork: which jobs run, with which token, with which secrets? Can it write a cache, a package or an artifact that a later run on `main` or `dev` reads? |
| A2.2 | Is any text an outsider controls (a branch name, a title, an input) used inside a `run:` line? |
| A2.3 | Is every secret handed to a `run:` step through `env`, never written into the script's text? |
| A2.4 | Do checkouts in jobs whose token can write packages keep the token on disk (`persist-credentials`)? |
| A2.5 | `test-images.yml` builds any ref with a token that writes packages: who can start it? |
| A2.6 | Is every file a workflow downloads checked against a checksum before it runs? |
| A2.7 | Is any job's `permissions` wider than its steps use? |
| A2.8 | The Dockerfiles' base images: pinned by tag or by digest? Noted, a decision for the triage |

### A3. What the public can read

Logs are open to anyone. Artifacts are open to anyone signed in to GitHub. The patterns for the greps are the real
values in `deploy/.env` on the VPS, read from there and never written down.

| Row | What | Wanted |
|---|---|---|
| A3.1 | The logs and step summaries of the last 30 runs of each workflow | No real site or game address, IP, email, name or UUID |
| A3.2 | The newest artifact of each kind: the app's pictures, test logs, the exe | No real value in a picture or a text file. The exe carries the site's address by design: who can download it and for how long is noted |
| A3.3 | Every ref GitHub serves: all branches, all tags, `refs/pull/*` | The pre-push greps find nothing |
| A3.4 | Titles, bodies, comments and review comments of every pull request and issue, every commit message | The same greps find nothing |
| A3.5 | The branch list | Each branch is open work or merged and listed for deletion |
| A3.6 | The world's seed in a workflow file | Noted for Alex: a private value or not |

### A4. Packages

| Row | What | Wanted |
|---|---|---|
| A4.1 | Every container package of the owner: visibility, linked repository, who and what has access | Private. Linked to this repository. Actions access for this repository only |
| A4.2 | An anonymous pull of web, api and installer, by `latest` and by a commit's tag | Refused (I5) |
| A4.3 | The number of versions and the oldest of each | Noted |

### A5. The scanners

| Row | What | Wanted |
|---|---|---|
| A5.1 | CodeQL's last run on `main` and on `dev` | Four analyses each. The Monday run is there or due |
| A5.2 | CodeQL's open alerts | Counted by severity and rule for each branch, in the private register |
| A5.3 | Dependabot | Its file on `main` is read without an error. Its first pull requests target `dev`. Open alerts counted privately |
| A5.4 | Secret scanning's open alerts | None. Any alert: §1's exception |
| A5.5 | Snyk | Still watching `main`. The ignores of docs/43 item 12 are set |

### A6. The account's other repositories that touch the project

The private archive, the private security repository and the Mowzie's Mobs fork (public). For each: visibility,
collaborators, Actions on or off, secret names, deploy keys, webhooks. For the fork also: who can download the
artifact of its `dsw-build` runs and until when, set against docs/58 ("the jar is never published").

## 3. Part B: Alex, in GitHub's settings

Only the account's owner sees these pages. Each step: read the page, note what is there, change nothing. The VPS
session's report says which of steps 8 to 13 it has already read by API.

1. **Settings → Password and authentication.** Two-factor is on. A passkey or an authenticator app is a method, SMS
   is not the only one. The recovery codes are saved somewhere other than this PC.
2. **Settings → Sessions.** Every session is a device you know.
3. **Settings → SSH and GPG keys.** Every key is one you know, with its last-used date.
4. **Settings → Developer settings → Personal access tokens**, both lists. For each token: name, repositories,
   permissions, expiry, last used. Wanted: none without an expiry, each one a row in docs/38 §6, none wider than its
   job.
5. **Settings → Applications**, all three tabs. For each app: which repositories, read or write. Wanted: Snyk on
   this repository only, nothing you no longer use, no app on all repositories without a reason.
6. **Settings → Emails.** "Keep my email addresses private" is on. "Block command line pushes that expose my email"
   is on.
7. **Settings → Security log**, the last 30 days. Nothing you did not do.
8. **Repository → Settings → Collaborators.** Only you.
9. **Repository → Settings → Branches and Rules.** The rule for `main`: does it bind you as admin, who may bypass
   it. Whether `dev` has a rule.
10. **Repository → Settings → Actions → General.** Which actions may run, approval for outside contributors, the
    token's default, the retention in days.
11. **Repository → Settings → Secrets and variables → Actions, and Environments.** Names only.
12. **Repository → Settings → Code security.** The same as docs/54 §1.
13. **Your profile → Packages.** Every package says Private.
14. **The three other repositories of A6.** Settings → General for visibility, then Collaborators, then Actions.

Alex's answers go to the security planner, by step number. Never a token's value. No picture of a page that shows
a value just created.

## 4. Part C: triage and write-up

- The security planner triages. Each row that is not as wanted gets an `SR` id in the private register with a
  severity, a fix and its place in the build order.
- Rows that are Met go into docs/38: I7's evidence with the new date, §6's token rows, §8.
- docs/54 gains a "Reviewed" line with the date.
- Fixes: a setting is Alex's own click, given to him one at a time. A workflow change is a fix PR to `dev`.

## 5. Done means

- Every row of §2 and every step of §3 is Met, Private or Refused with who reads it instead.
- docs/11 has the date, the rows checked and the three counts.
- Nothing on GitHub was changed by the review.

## 6. Not in this review, and when to repeat it

Not here: the VPS, the AMP host, the code of the site, the api and the app (docs/38), Discord. Repeat the review when
a workflow's triggers or permissions change, when a collaborator, app or token is added, otherwise every three months.
