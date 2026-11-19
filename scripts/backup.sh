#!/usr/bin/env bash
# Copies of the portal's data, and the way back from one.
#
# The live database is on Supabase's Free plan, which keeps no backups, and every
# merge migrates it with no human step. A migration that drops the wrong rows
# passes every test (the tests run on made-up data) and raises no alert. So the
# Backup workflow takes a copy every night, the Release workflow takes one before
# it migrates, and CI proves on every pull request that a copy restores row for
# row. docs/RESTORE.md is the owner's guide.
#
#   scripts/backup.sh dump <file> [--remote]   the portal's data as SQL (the local stack by default)
#   scripts/backup.sh encrypted <dir> [--remote]
#                                              dump, and encrypt the dump to BACKUP_PUBLIC_KEY
#   scripts/backup.sh pending [--remote]       "true" when migrations are waiting to be applied
#   scripts/backup.sh restore <file> [--owner <account id>]
#                                              load a dump: into the local stack, or into RESTORE_DB_URL
#   scripts/backup.sh drill                    back up the local stack as production is backed up (encrypted, to
#                                              a throwaway key), wipe it, restore it, and compare every row
#
# A dump holds data only, from the `portal` schema. Not in it: sign-in accounts
# (Supabase's own `auth` schema), and the book's pages, which are the owner's own
# PDF and load again with `npm run load:book`.
set -euo pipefail
cd "$(dirname "$0")/.."

# Left out of every dump: reloadable, and book text must not travel.
BOOK_TABLES="portal.book_pages,portal.book_sections"

fail() {
  echo "backup: $*" >&2
  exit 1
}

# A plain dump only ever exists in here, never where a workflow uploads from.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The local stack's database container, which also lends its psql: a host's own may be missing or too old for the dump.
container() {
  local config="${SUPABASE_WORKDIR:-.}/supabase/config.toml"
  local id
  id="$(sed -nE 's/^project_id *= *"([^"]+)".*/\1/p' "$config" | head -1)"
  [ -n "$id" ] || fail "no project_id in $config"
  echo "supabase_db_$id"
}

# psql against the local stack, or against RESTORE_DB_URL when it is set. Reads SQL from stdin.
run_sql() {
  local c
  c="$(container)"
  docker inspect "$c" >/dev/null 2>&1 || fail "the local database is not running: npm run db:start"
  if [ -n "${RESTORE_DB_URL:-}" ]; then
    docker exec -i -e PGCONNECT_TIMEOUT=20 "$c" psql "$RESTORE_DB_URL" "$@"
  else
    docker exec -i "$c" psql -U postgres -d postgres "$@"
  fi
}

dump() {
  local file="${1:?usage: backup.sh dump <file> [--remote]}"
  shift
  npx supabase db dump "$@" --data-only --use-copy --schema portal --exclude "$BOOK_TABLES" -f "$file" >&2
  # A dump that is not the portal's, or holds nobody, is not a backup.
  grep -q '^COPY "portal"."members" ' "$file" || fail "the dump has no members table, so it is not the portal's data"
  [ "$(members "$file" | wc -l)" -gt 0 ] || fail "the dump has no member in it, so it is not a copy of a portal in use"
  if grep -qE '^COPY "portal"\."book_(pages|sections)" ' "$file"; then fail "the dump holds the book's pages"; fi
}

# The rows of the members table in a dump: account id, role, name, ...
members() {
  awk '/^COPY "portal"\."members" /{on=1; next} on && /^\\\.$/{exit} on' "$1"
}

encrypted() {
  local out="${1:?usage: backup.sh encrypted <dir> [--remote]}"
  shift
  [ -n "${BACKUP_PUBLIC_KEY:-}" ] || fail "BACKUP_PUBLIC_KEY is not set (docs/RESTORE.md, one-time setup)"
  mkdir -p "$out"
  dump "$WORK/portal-data.sql" "$@"

  local home="$WORK/public-key"
  rm -rf "$home"
  mkdir -m 700 "$home"
  printf '%s\n' "$BACKUP_PUBLIC_KEY" | gpg --homedir "$home" --batch --quiet --import ||
    fail "BACKUP_PUBLIC_KEY is not a public key gpg can read"
  local key
  key="$(gpg --homedir "$home" --batch --with-colons --list-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
  [ -n "$key" ] || fail "BACKUP_PUBLIC_KEY holds no public key"
  local name
  name="portal-data-$(date -u +%Y%m%d-%H%M%S).sql.gpg"
  gpg --homedir "$home" --batch --yes --trust-model always --recipient "$key" \
    --output "$out/$name" --encrypt "$WORK/portal-data.sql"
  rm -f "$WORK/portal-data.sql"
  only_encrypted "$out"
  echo "Encrypted to key ${key: -16}: $out/$name ($(wc -c <"$out/$name") bytes). Only its private key opens it." >&2
}

# The upload folder may hold nothing but files encrypted to a public key. Artifacts of a public repository are public.
only_encrypted() {
  local dir="$1" file packets
  if find "$dir" -type f ! -name '*.gpg' | grep -q .; then
    fail "$dir holds a file that is not encrypted: $(find "$dir" -type f ! -name '*.gpg' | head -1)"
  fi
  [ -n "$(find "$dir" -type f -name '*.gpg')" ] || fail "$dir holds no backup"
  for file in "$dir"/*.gpg; do
    # gpg can't open it here (no private key, so it exits with an error) but still names
    # the packet a public-key message starts with.
    packets="$(gpg --batch --list-packets "$file" 2>/dev/null || true)"
    grep -q '^:pubkey enc packet:' <<<"$packets" || fail "$file is not encrypted to a public key"
  done
}

pending() {
  local out
  out="$(npx supabase db push "$@" --dry-run --yes --output-format json --agent no 2>/dev/null || true)"
  # Its last line of JSON says whether the database is up to date. Anything unreadable counts as pending: a backup too many is the safe mistake.
  if printf '%s\n' "$out" | grep '^{' | tail -1 | grep -q '"upToDate":true'; then echo false; else echo true; fi
}

restore() {
  local file="" owner=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --owner)
        owner="${2:?--owner needs an account id}"
        shift 2
        ;;
      *)
        file="$1"
        shift
        ;;
    esac
  done
  [ -f "$file" ] || fail "usage: backup.sh restore <file> [--owner <account id>]"
  local tables
  tables="$(grep -oE '^COPY "portal"\."[a-z0-9_]+"' "$file" | sed 's/^COPY //' | paste -sd, -)"
  [ -n "$tables" ] || fail "$file holds no portal tables"

  # A new project has new sign-in accounts. The owner's id from the dump becomes the one given, wherever it appears.
  local rewrite=(cat)
  if [ -n "$owner" ]; then
    local uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    [[ "$owner" =~ $uuid ]] || fail "--owner takes an account id, like 00000000-0000-4000-8000-000000000001"
    local old
    old="$(members "$file" | awk -F'\t' '$2 == "owner" { print $1; exit }')"
    [[ "$old" =~ $uuid ]] || fail "the dump has no owner to re-link"
    rewrite=(sed "s/$old/$owner/g")
  fi

  # Migrations put default rows in some tables (the money categories and rules), so
  # each table in the dump is emptied first. One transaction: it restores everything
  # or changes nothing.
  {
    echo "BEGIN;"
    echo "TRUNCATE $tables CASCADE;"
    "${rewrite[@]}" <"$file"
    echo "COMMIT;"
  } | run_sql -q -v ON_ERROR_STOP=1 >/dev/null
  echo "Restored $(echo "$tables" | tr ',' '\n' | wc -l) tables from $file." >&2
}

# One line a table: its name, how many rows, and a checksum of every row. Then one line a sequence.
fingerprint() {
  run_sql -q -t -A <<'SQL'
select t.table_name || ' ' || (xpath('/row/n/text()', x))[1]::text || ' ' || coalesce((xpath('/row/h/text()', x))[1]::text, '-')
from information_schema.tables t,
  lateral query_to_xml(
    format(
      'select count(*) as n, md5(string_agg(md5(r::text), '''' order by md5(r::text))) as h from portal.%I r',
      t.table_name
    ), false, true, ''
  ) x
where t.table_schema = 'portal' and t.table_type = 'BASE TABLE'
  and t.table_name not in ('book_pages', 'book_sections')
order by t.table_name;
select 'sequence ' || sequencename || ' ' || coalesce(last_value::text, '-')
from pg_sequences where schemaname = 'portal' order by sequencename;
SQL
}

drill() {
  [ -z "${RESTORE_DB_URL:-}" ] || fail "the drill wipes its database: it only ever runs on the local stack"

  # A key pair made for this drill and thrown away with it, standing in for the owner's.
  local home="$WORK/drill-key"
  mkdir -m 700 "$home"
  gpg --homedir "$home" --batch --quiet --passphrase '' --quick-generate-key "Restore drill <drill@example.test>" default default never
  BACKUP_PUBLIC_KEY="$(gpg --homedir "$home" --batch --armor --export)"
  export BACKUP_PUBLIC_KEY

  # Back up the way production is backed up, and note what the database held.
  encrypted "$WORK/upload"
  fingerprint >"$WORK/before.txt"
  local rows
  rows="$(awk '$1 != "sequence" { n += $2 } END { print n + 0 }' "$WORK/before.txt")"
  [ "$rows" -gt 0 ] || fail "the local database is empty: nothing to drill with"

  # Lose everything: the database again from its migrations alone, without the seed.
  npx supabase db reset --no-seed >&2
  fingerprint >"$WORK/wiped.txt"
  if diff -q "$WORK/before.txt" "$WORK/wiped.txt" >/dev/null; then fail "the reset changed nothing, so the drill proves nothing"; fi

  # The way back, as docs/RESTORE.md gives it: decrypt, then restore.
  gpg --homedir "$home" --batch --quiet --output "$WORK/restored.sql" --decrypt "$WORK"/upload/*.gpg
  restore "$WORK/restored.sql"
  fingerprint >"$WORK/after.txt"
  diff "$WORK/before.txt" "$WORK/after.txt" >&2 ||
    fail "the restored database differs from the one that was backed up (lines above: < before, > after)"

  # A new project means a new sign-in account: the owner's rows must follow it.
  local account="11111111-2222-4333-8444-555555555555"
  restore "$WORK/restored.sql" --owner "$account"
  local owners
  owners="$(echo "select count(*) from portal.members where role = 'owner' and account_id = '$account'" | run_sql -q -t -A)"
  [ "$owners" = "1" ] || fail "restoring with --owner did not re-link the owner"
  restore "$WORK/restored.sql"

  echo "Restore drill: $(grep -vc '^sequence ' "$WORK/before.txt") tables and $rows rows backed up, encrypted, wiped, restored and identical."
}

command="${1:-}"
[ $# -gt 0 ] && shift
case "$command" in
  dump | encrypted | pending | restore | drill) "$command" "$@" ;;
  *) fail "usage: backup.sh dump <file> [--remote] | encrypted <dir> | pending [--remote] | restore <file> [--owner <id>] | drill" ;;
esac
