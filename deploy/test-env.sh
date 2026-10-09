# Sourced by deploy/deploy.sh and deploy/test-up.sh (docs/42): the test server's lines of deploy/.env, read and checked.
#
#   envval NAME        the value of NAME in deploy/.env ("" when it is not there)
#   test_env_check     prints every TEST_ line that is missing or wrong, and fails when there is one

envval() { sed -n "s/^$1=//p" deploy/.env | tail -1; }

test_env_check() {
  local bad=0 dir url host cookie mock token summary live_token
  say() { echo "  $*" >&2; bad=1; }
  dir=$(envval TEST_DIR)
  if [[ ! "$dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then say "TEST_DIR: the test checkout's absolute path (/home/ladm/Minecraft-site-test)"
  elif [ "$dir" = "$(pwd)" ]; then say "TEST_DIR is this checkout, the live one: the test server has a checkout of its own"
  elif [ ! -d "$dir/.git" ]; then say "TEST_DIR=$dir is not a git checkout yet (as ladm: git clone -b dev <repository> $dir)"
  elif [ "$(cat "$dir/.git/HEAD" 2>/dev/null)" != "ref: refs/heads/dev" ]; then say "$dir is not on the branch dev"
  fi
  url=$(envval TEST_AUTH_URL)
  host=${url#https://}
  cookie=$(envval COOKIE_DOMAIN)
  if [[ ! "$url" =~ ^https://[a-z0-9.-]+$ ]]; then say "TEST_AUTH_URL: the test site's address, https://<name> with no path"
  elif [ "$url" = "$(envval AUTH_URL)" ]; then say "TEST_AUTH_URL is the live site's address"
  elif [ -n "$cookie" ] && [[ "$host" != *"$cookie" ]]; then say "TEST_AUTH_URL ($host) is not under COOKIE_DOMAIN ($cookie): the live site's admin check could not see who is asking"
  fi
  [ -n "$(envval TEST_AUTH_SECRET)" ] || say "TEST_AUTH_SECRET: the test site's own session secret (openssl rand -base64 32)"
  [ "$(envval TEST_AUTH_SECRET)" != "$(envval AUTH_SECRET)" ] || say "TEST_AUTH_SECRET is the live site's AUTH_SECRET: give the test site its own"
  token=$(envval TEST_API_SERVICE_TOKEN); summary=$(envval TEST_SUMMARY_TOKEN); live_token=$(envval API_SERVICE_TOKEN)
  [ "${#token}" -ge 32 ] || say "TEST_API_SERVICE_TOKEN: at least 32 characters (openssl rand -hex 32)"
  [ "${#summary}" -ge 32 ] || say "TEST_SUMMARY_TOKEN: at least 32 characters (openssl rand -hex 32)"
  # docs/45: optional; when set, a token of its own
  local apptok; apptok=$(envval TEST_APP_TOKEN)
  if [ -n "$apptok" ]; then [ "${#apptok}" -ge 32 ] || say "TEST_APP_TOKEN: at least 32 characters (openssl rand -hex 32)"; { [ "$apptok" != "$live_token" ] && [ "$apptok" != "$token" ] && [ "$apptok" != "$summary" ]; } || say "TEST_APP_TOKEN must be a token of its own"; fi
  { [ "$token" != "$live_token" ] && [ "$summary" != "$live_token" ] && [ "$summary" != "$token" ]; } || say "TEST_API_SERVICE_TOKEN, TEST_SUMMARY_TOKEN and API_SERVICE_TOKEN must be three different tokens"
  [ -n "$(envval TEST_SERVER_ADDRESS)" ] || say "TEST_SERVER_ADDRESS: the test server's game address on mc-router"
  # docs/42a (2026-10-08): the test server never posts to the players' channels. On 2026-10-08 the live webhooks were
  # copied here and test joins reached the players' feed; a test webhook equal to any live one is refused.
  local w l
  for w in TEST_DISCORD_WEBHOOK_FEED TEST_DISCORD_WEBHOOK_ADMIN TEST_DISCORD_WEBHOOK_UPDATES; do
    [ -n "$(envval $w)" ] || continue
    for l in DISCORD_WEBHOOK_FEED DISCORD_WEBHOOK_ADMIN DISCORD_WEBHOOK_UPDATES; do
      [ "$(envval $w)" != "$(envval $l)" ] || say "$w is the live $l: the test server must not post to the players' Discord (leave it empty, or a private channel's webhook)"
    done
  done
  [[ "$(envval TEST_IMAGE_TAG)" =~ ^[A-Za-z0-9._-]*$ ]] || say "TEST_IMAGE_TAG: an image tag (test, or a commit)"
  mock=$(envval TEST_AMP_MOCK)
  if [ "$mock" != 1 ]; then
    [ -n "$(envval TEST_AMP_INSTANCE_ID)" ] || say "TEST_AMP_INSTANCE_ID: the id of the AMP instance DeepslateTest01"
    [ "$(envval TEST_AMP_INSTANCE_ID)" != "$(envval AMP_INSTANCE_ID)" ] || say "TEST_AMP_INSTANCE_ID is the live instance's id"
    [ -n "$(envval TEST_AMP_USERNAME)" ] || say "TEST_AMP_USERNAME: the AMP user the test api signs in as"
    [ -n "$(envval TEST_AMP_PASSWORD)" ] || say "TEST_AMP_PASSWORD: that user's password"
    [ -n "$(envval TEST_RSYNC_TARGET)" ] || say "TEST_RSYNC_TARGET: user@host: of the test key's rrsync line (docs/42a)"
    [ -s deploy/keys-test/deploy.key ] || say "deploy/keys-test/deploy.key is missing: the test instance's own deploy key (docs/42 §5.4)"
  fi
  [ "$bad" = 0 ]
}
