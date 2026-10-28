# deepslate-caddy: the home stack's Caddy with its Caddyfile (deploy/home/Caddyfile) inside, so a new Caddyfile arrives
# with a redeploy. The host names stay in the stack's .env. Built by CI from the repo root.
FROM caddy:2-alpine

COPY deploy/home/Caddyfile /etc/caddy/Caddyfile
