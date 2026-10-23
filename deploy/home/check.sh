#!/usr/bin/env bash
# The same checks as deploy/check.sh (typecheck, lint, tests in a memory-capped container), from the home checkout.
exec "$(dirname "$(readlink -f "$0")")/../check.sh" "$@"
