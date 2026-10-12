# 54 · GitHub security

Started 2026-10-12. GitHub's own security features for this repository: what is switched on, what lives in the
repository, and how the results are handled. It sits next to docs/38 (the security register); open findings are never
written here or anywhere else in this public repository.

## 1. Switched on by Alex in Settings (2026-10-12)

| Setting | State | Why |
|---|---|---|
| Private vulnerability reporting | On | The way in for anyone outside the group; `SECURITY.md` points to it |
| Secret scanning | On | Catches a token or key that reaches a commit |
| Push protection | On | Refuses the push before such a commit is public, on top of the pre-push greps (docs/38 §1) |
| Dependabot alerts | On | Advisories against the lockfiles, in the Security tab |
| Dependabot security updates | **Off** | They open their pull requests against `main` only, so a fix would skip `dev` and the test site. Version updates (§2) go to `dev` instead and pick up the same fixes on their weekly run |
| Code scanning, default setup | **Not enabled** | Must stay off: the advanced setup in §2 does the scanning, and GitHub refuses an advanced setup's uploads while default setup is on |

## 2. What the repository adds

- **`.github/workflows/codeql.yml`:** CodeQL, advanced setup, `security-extended` queries, four languages, none of
  them built:
  - `javascript-typescript`: `apps/web`, `apps/api`, `packages/modpack`, `tools/designer`
  - `csharp`: `installer/app` (and its tests), read without a build, so no Windows runner
  - `python`: `deploy/dockhand-sync.py` and the icon and art scripts
  - `actions`: the workflow files themselves
  It runs on pushes and pull requests to `main` and `dev` (not for a change to docs or the Markdown files at the
  top), every Monday at 03:17 UTC, and by hand. Advanced rather than default setup because default setup scans
  `main` only and wants C# built. It is not a required check, so its docs filter cannot leave a pull request
  waiting. Results: Security tab, Code scanning, tool CodeQL, one category per language.
- **`.github/codeql/codeql-config.yml`:** leaves out `node_modules`, `.next`, every `dist` (the modpack build's
  `dist/server/mods` jar cache among them), coverage, the Windows app's `bin` and `obj`, and `docs/`.
- **`.github/dependabot.yml`:** version updates, weekly on Mondays, at most five open pull requests per ecosystem,
  commit messages prefixed `deps`, every one targeting `dev`:
  - GitHub Actions: one group for everything. The pins stay full commit SHAs with the version comment.
  - npm, at the workspace root (web, api and modpack share one lockfile): minor and patch in one group.
  - NuGet, `installer/app`: minor and patch in one group. A bump here changes the launcher, so its build goes to no
    player or tester until Alex has tried it on his own PC.
  - Docker, the `apps/web` and `apps/api` base images: minor and patch in one group.
  Major versions are ignored everywhere: they are planned work (docs/10 item 18 for Next 16, Prisma 7, a Node major).
- **`SECURITY.md`:** how to report (private vulnerability reporting, no email, no public issues), what is in and out
  of scope, what is supported, what to expect.

## 3. How a Dependabot pull request flows

1. Dependabot reads `dependabot.yml` from `main`, the default branch. Nothing happens until this file has reached
   `main` in the next `dev` → `main` pull request; until then GitHub shows no errors for it either, so the
   configuration is unproven until it is there.
2. Its pull requests target `dev`. `ci.yml`'s `check` runs on them like on any other pull request.
3. Merged into `dev`, the change rebuilds the test site's images (`dev-images.yml`) and is tried there.
4. It reaches live in the normal `dev` → `main` pull request, with everything else on `dev`.
5. A NuGet bump also waits for Alex's own PC before any player or tester gets the build.

The catch, again: Dependabot **security** updates would target `main` and skip steps 2 and 3, so they stay off. A
security fix in a minor or patch release arrives in the next weekly version update; one that needs a major is
planned work, triaged in docs/38.

## 4. Next to Snyk

Snyk still watches `main`, as before (docs/38 §5.1). GitHub's alerts and CodeQL now watch `main` and `dev`. When both
raise the same thing it is triaged once, in docs/38, with both tools' identifiers in the row, and dismissed or ignored
in both with the same reason.

## 5. Findings stay private

An open finding from CodeQL, Dependabot or secret scanning is handled like any other: it goes to the private register
(docs/38, "Where the open findings are"), never into this repository's docs, commits or pull requests. It appears in
docs/38 §5 once it is Fixed, Verified, Accepted or Not applicable, with the date.
