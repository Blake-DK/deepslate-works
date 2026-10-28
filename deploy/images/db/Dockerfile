# deepslate-db: the database, always on the newest PostgreSQL. Built by CI (.github/workflows/ci.yml) from the repo root.
#
# pgautoupgrade is the official postgres image with the older majors' binaries beside it: on start it sees data from an
# older major, upgrades it with pg_upgrade --link, then starts. pre-upgrade.sh copies the data first (there is no way
# back otherwise) and refuses data it would not find. Its `alpine` tag follows the newest major it can upgrade to; the
# weekly CI run rebuilds this image so a redeploy picks it up.
FROM pgautoupgrade/pgautoupgrade:alpine

COPY deploy/images/db/pre-upgrade.sh /usr/local/bin/deepslate-pre-upgrade.sh
RUN chmod 755 /usr/local/bin/deepslate-pre-upgrade.sh

# pgautoupgrade's own healthcheck says healthy while an upgrade is running (it looks for its lock file and exits 0), so
# web and the migrations would start against a database that is not there. This one is healthy only when it answers.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD test ! -e "$PGDATA/upgrade_in_progress.lock" && pg_isready -h 127.0.0.1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"

ENTRYPOINT ["/usr/local/bin/deepslate-pre-upgrade.sh"]
CMD ["postgres"]
