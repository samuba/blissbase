#!/bin/bash

# The Mac path builds a remote command of the form:
#   bash -s --$(printf ' %q' "$@")
# `bash -s --help` is parsed as a bash option and fails with
# `bash: --: invalid option`. The `--` keeps those words as script arguments
# (a branch name, or --help).

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
deploy="$script_dir/deployWhatsapp2Sqlite.sh"
needle="bash -s --\$(printf ' %q' \"\$@\")"

if ! grep -F "$needle" "$deploy" >/dev/null; then
    printf '%s\n' "deploy script is missing the bash -s -- argument separator" >&2
    exit 1
fi

if grep -n -E -- '--migrate|^MIGRATE=|require_migrate_if_legacy' "$deploy" >/dev/null; then
    printf '%s\n' "deploy script still has the --migrate flag" >&2
    grep -n -E -- '--migrate|^MIGRATE=|require_migrate_if_legacy' "$deploy" >&2
    exit 1
fi

help_text=$(bash "$deploy" --help)
if ! printf '%s\n' "$help_text" | grep -F -q 'Usage: deployWhatsapp2Sqlite.sh [branch]'; then
    printf '%s\n' "usage is not deployWhatsapp2Sqlite.sh [branch]" >&2
    printf '%s\n' "$help_text" >&2
    exit 1
fi
if printf '%s\n' "$help_text" | grep -F -q -- '--migrate'; then
    printf '%s\n' "usage still documents --migrate" >&2
    printf '%s\n' "$help_text" >&2
    exit 1
fi

err=$(mktemp)
if bash "$deploy" --migrate >"$err" 2>&1; then
    printf '%s\n' "expected --migrate to be rejected" >&2
    rm -f -- "$err"
    exit 1
fi
if ! grep -q 'Unknown option: --migrate' "$err"; then
    printf '%s\n' "expected unknown-option error for --migrate" >&2
    cat "$err" >&2
    rm -f -- "$err"
    exit 1
fi
rm -f -- "$err"

# Run the same text the remote shell parses. bash -c does the word split.
run_remote() {
    local remote_cmd
    remote_cmd="bash -s --$(printf ' %q' "$@")"
    bash -c "$remote_cmd" <<'EOF'
printf '%s' "$#"
printf ' <%s>' "$@"
printf '\n'
EOF
}

assert_eq() {
    local got="$1"
    local want="$2"
    local label="$3"
    if [ "$got" != "$want" ]; then
        printf '%s\n' "$label" >&2
        printf 'got:  [%s]\n' "$got" >&2
        printf 'want: [%s]\n' "$want" >&2
        exit 1
    fi
}

err=$(mktemp)
broken="bash -s$(printf ' %q' --help)"
if bash -c "$broken" </dev/null >/dev/null 2>"$err"; then
    printf '%s\n' "expected bash -s --help to fail" >&2
    rm -f -- "$err"
    exit 1
fi
if ! grep -q 'invalid option' "$err"; then
    printf '%s\n' "expected 'invalid option' from bash -s --help" >&2
    cat "$err" >&2
    rm -f -- "$err"
    exit 1
fi
rm -f -- "$err"

# No positional parameters: printf still emits an empty word. The deploy
# script treats an empty branch as "use the default", so this must succeed.
assert_eq "$(run_remote)" "1 <>" "no arguments"

assert_eq "$(run_remote my-branch)" "1 <my-branch>" "branch"
assert_eq "$(run_remote "branch with spaces")" "1 <branch with spaces>" "quoted branch"
assert_eq "$(run_remote --help)" "1 <--help>" "--help"

printf '%s\n' "PASS bash -s -- keeps script arguments"
