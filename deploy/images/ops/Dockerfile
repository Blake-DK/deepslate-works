# deepslate-ops: the stack's one-shot steps that run before the site starts on each redeploy (deploy/home/docker-compose.yml):
# `init` (the data folders and their owners) and `repo-sync` (the checkout brought forward). Built by CI from the repo root.
FROM alpine:latest

RUN apk add --no-cache git

COPY deploy/git-guard.sh deploy/images/ops/init.sh deploy/images/ops/repo-sync.sh /usr/local/lib/deepslate/

CMD ["sh", "-c", "echo 'deepslate-ops: name a step: init.sh or repo-sync.sh' >&2; exit 2"]
