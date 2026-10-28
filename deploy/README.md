# deploy/

The site runs at home on docker-01v as one Docker Compose stack, `deepslate`, managed in Dockhand. **To deploy, read
[home/README.md](home/README.md)**; docs/09 has the operations side. The VPS is no longer used (2026-10-28), and its
files (its compose file, `.env.example`, `deploy.sh`, the test scripts, the WireGuard and Caddy examples, the
Dockhand mirror) were removed the same day; git history keeps them.

| File | What it is |
|---|---|
| `home/` | The stack: its compose file (the reference for Dockhand's copy), `.env.example`, Caddyfile and README |
| `images/` | The stack's own images, built by CI: `db`, `backups`, `caddy`, `designer`, `ops` (init and repo-sync), `installer` |
| `check.sh` | Typecheck, lint and tests in a memory-capped container, on a host without Node |
| `backup-loop.sh` | The nightly database dump, built into the `deepslate-backups` image |
| `git-guard.sh` | The `.git/hooks` check, built into the `deepslate-ops` image for `repo-sync` |
| `server-mods.sh` | Copies the mods the server loaded at its last start into `modpack/server-loaded.json` |
| `keys/`, `keys-test/` | Git-ignored, made by hand: the deploy keys (`deploy.key`, uid 1000) and `known_hosts` for the live and test instances |

The host never builds images: images come from GitHub Actions (`.github/workflows/ci.yml`). Never `docker build` or
`docker compose up --build` on it.

## The checkout's guards

`web` can write the live checkout's `.git` (Admin → Lock commits there), so the stack's `repo-sync` compares it with
copies under `/root/.config/deepslate` that no container can write, before it fetches. When one differs it says so in
its log (`docker logs deepslate-repo-sync`) and leaves the checkout as it was; the site still starts.

`.git/config`: `repo-sync` compares `git config --local --list`, sorted, with `git-config.expected`. When the change
is yours (a new remote, a credential helper you set), read `.git/config` by eye and remake the copy as root:
`git -C /nvme/stacks/deepslate config --local --list | sort > /root/.config/deepslate/git-config.expected`.

`.git/hooks`: anything there but `.sample` files and the hooks listed with their sha256 in `git-hooks.expected`, or
`core.hooksPath` set in `.git/config`, stops it (`git-guard.sh`). After reading each hook by eye, as root:
`(cd /nvme/stacks/deepslate/.git/hooks && sha256sum pre-push) > /root/.config/deepslate/git-hooks.expected`.

Both files must exist and be readable by uid 1000 (`repo-sync` runs as the checkout's owner): mode 644.
