#!/usr/bin/env python3
"""Mirror this stack's compose file and env into Dockhand (stack `deepslate`, environment VPS-01V).

The repo's deploy/docker-compose.yml and deploy/.env are the source of truth. Dockhand keeps a copy so the
stack can be seen, pulled and restarted from its UI; this script refreshes that copy and never starts,
stops or restarts anything. deploy.sh runs it after every deploy.

  deploy/dockhand-sync.py            register the stack if Dockhand does not manage it yet, else update it
  deploy/dockhand-sync.py --check    only report whether the mirror matches (exit 1 if it does not)

Needs: DOCKHAND_URL (default http://100.64.0.10:3690) and an API key in DOCKHAND_KEY_FILE
(default /root/.config/deepslate/dockhand-key, first dh_... token in the file).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.realpath(__file__))
URL = os.environ.get("DOCKHAND_URL", "http://100.64.0.10:3690").rstrip("/")
KEY_FILE = os.environ.get("DOCKHAND_KEY_FILE", "/root/.config/deepslate/dockhand-key")
ENV_ID = int(os.environ.get("DOCKHAND_ENV_ID", "3"))
STACK = "deepslate"
MIRROR_DIR = os.environ.get("DOCKHAND_STACK_DIR", f"/data/stacks/{STACK}")


def key():
    m = re.search(r"dh_[A-Za-z0-9_-]+", open(KEY_FILE).read())
    if not m:
        raise SystemExit(f"dockhand-sync: no dh_ key in {KEY_FILE}")
    return m.group(0)


def req(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(URL + path, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:300]


def env_pairs(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def write_local_mirror(compose, env):
    """The agent runs compose from this directory; keep it identical to what Dockhand stores."""
    try:
        os.makedirs(MIRROR_DIR, mode=0o755, exist_ok=True)
        for name, content, mode in (("compose.yaml", compose, 0o644), (".env", env, 0o600)):
            path = os.path.join(MIRROR_DIR, name)
            fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
            with os.fdopen(fd, "w") as f:
                f.write(content)
            os.chmod(path + ".tmp", mode)
            os.replace(path + ".tmp", path)
        return True
    except PermissionError:
        return False


def main():
    check = "--check" in sys.argv
    compose = open(os.path.join(HERE, "docker-compose.yml")).read()
    env = open(os.path.join(HERE, ".env")).read()
    if re.search(r"^\s+build:", compose, re.M):
        raise SystemExit("dockhand-sync: the compose file has a build section; this stack is pull-only, refusing")
    if not env_pairs(env).get("DEEPSLATE_DIR", "").startswith("/"):
        raise SystemExit("dockhand-sync: DEEPSLATE_DIR in deploy/.env must be an absolute path (Dockhand runs the stack from its own directory)")
    token = key()

    st, sources = req("GET", f"/api/stacks/sources?env={ENV_ID}", token=token)
    if st != 200:
        raise SystemExit(f"dockhand-sync: cannot list stacks ({st}): {sources}")
    managed = STACK in sources

    st, cur = req("GET", f"/api/stacks/{STACK}/compose?env={ENV_ID}", token=token) if managed else (404, {})
    cur_compose = cur.get("content") if isinstance(cur, dict) else None
    st_e, cur_env = req("GET", f"/api/stacks/{STACK}/env/raw?env={ENV_ID}", token=token) if managed else (404, {})
    cur_env_text = cur_env.get("content") if isinstance(cur_env, dict) else None
    same_compose = cur_compose == compose
    same_env = cur_env_text is not None and env_pairs(cur_env_text) == env_pairs(env)

    if check:
        print(f"dockhand: managed={managed} compose={'same' if same_compose else 'differs'} env={'same' if same_env else 'differs'}")
        sys.exit(0 if managed and same_compose and same_env else 1)

    if not managed:
        st, res = req("POST", f"/api/stacks?env={ENV_ID}", {"name": STACK, "compose": compose, "rawEnvContent": env, "environmentId": ENV_ID, "start": False}, token)
        if st not in (200, 201):
            raise SystemExit(f"dockhand-sync: registering the stack failed ({st}): {res}")
        print("dockhand: stack registered (not started, nothing restarted)")
    else:
        if not same_compose:
            st, res = req("PUT", f"/api/stacks/{STACK}/compose?env={ENV_ID}", {"content": compose, "restart": False}, token)
            if st != 200:
                raise SystemExit(f"dockhand-sync: compose update failed ({st}): {res}")
        if not same_env:
            st, res = req("PUT", f"/api/stacks/{STACK}/env/raw?env={ENV_ID}", {"content": env}, token)
            if st != 200:
                raise SystemExit(f"dockhand-sync: env update failed ({st}): {res}")
        print(f"dockhand: compose {'unchanged' if same_compose else 'updated'}, env {'unchanged' if same_env else 'updated'} (nothing restarted)")
    if not write_local_mirror(compose, env):
        print(f"dockhand: could not write {MIRROR_DIR} (run as root); Dockhand's own copy is up to date")


if __name__ == "__main__":
    main()
