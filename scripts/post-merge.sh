#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply committed Drizzle migrations.  drizzle-kit migrate is idempotent: it
# records applied migrations in the drizzle_migrations table and skips anything
# already applied.  Both 0000 (empty baseline marker) and 0001 (agent tables)
# are safe to run on fresh or existing databases — agent tables use IF NOT EXISTS.
pnpm --filter @workspace/db run migrate
