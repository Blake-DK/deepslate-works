# Deploying on vps-01v

```
cd /opt/deepslate
cp deploy/.env.example deploy/.env   # fill in
docker compose -f deploy/docker-compose.yml up -d --build
# first admin without Discord configured:
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex"
```

Caddy: add the block from `deploy/Caddyfile.snippet` and reload (recipe in /root/HOSTING.md).
Update: `git pull && docker compose -f deploy/docker-compose.yml up -d --build`. Migrations run on container start.
Logs: `docker logs -f deepslate-web`. Health: `https://deepslate.dsw.test/api/health`.
