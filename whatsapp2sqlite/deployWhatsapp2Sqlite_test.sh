#!/bin/bash

# The Mac path builds a remote command of the form:
#   bash -s --$(printf ' %q' "$@")
# `bash -s --migrate` is parsed as a bash option and fails with
# `bash: --: invalid option`. The `--` keeps those words as script arguments.

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
deploy="$script_dir/deployWhatsapp2Sqlite.sh"
needle="bash -s --\$(printf ' %q' \"\$@\")"

if ! grep -F "$needle" "$deploy" >/dev/null; then
    printf '%s\n' "deploy script is missing the bash -s -- argument separator" >&2
    exit 1
fi

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
broken="bash -s$(printf ' %q' --migrate)"
if bash -c "$broken" </dev/null >/dev/null 2>"$err"; then
    printf '%s\n' "expected bash -s --migrate to fail" >&2
    rm -f -- "$err"
    exit 1
fi
if ! grep -q 'invalid option' "$err"; then
    printf '%s\n' "expected 'invalid option' from bash -s --migrate" >&2
    cat "$err" >&2
    rm -f -- "$err"
    exit 1
fi
rm -f -- "$err"

# No positional parameters: printf still emits an empty word. The deploy
# script treats an empty branch as "use the default", so this must succeed.
assert_eq "$(run_remote)" "1 <>" "no arguments"

assert_eq "$(run_remote --migrate)" "1 <--migrate>" "--migrate"
assert_eq "$(run_remote --migrate my-branch)" "2 <--migrate> <my-branch>" "--migrate and branch"
assert_eq "$(run_remote "branch with spaces")" "1 <branch with spaces>" "quoted branch"

printf '%s\n' "PASS bash -s -- keeps script arguments"
