# deepslate-backups: the nightly dump (deploy/backup-loop.sh) in the newest postgres image. Built by CI from the repo root.
#
# pg_dump must be at least as new as the server. deepslate-db follows pgautoupgrade, which reaches a new major only
# after the official image does, so the official `alpine` tag is never older than the database.
FROM postgres:alpine

COPY deploy/backup-loop.sh /backup-loop.sh

CMD ["sh", "/backup-loop.sh"]
