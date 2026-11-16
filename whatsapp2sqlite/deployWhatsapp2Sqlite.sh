#!/bin/bash

# Deploy whatsapp2sqlite without touching runtime state.
#
# The live directory ($HOME/whatsapp2sqlite by default) is not a git checkout.
# A separate sparse clone of blissbase is updated with fetch + reset, then only
# git-tracked files are copied onto the live directory. Ignored and other
# untracked files (SQLite, config, media, …) are never deleted or overwritten.
#
# The binary is built from ./cmd/whatsapp2sqlite into a temp file. The user
# service is stopped only after that build is an ELF executable, then the
# previous binary is kept as whatsapp2sqlite.prev and the new one is moved
# into place.
#
# First adoption of an existing directory requires --migrate. That flag does
# not delete anything; it only acknowledges the directory already has files.
#
# Test hooks (do not set these on the server):
#   WHATSAPP2SQLITE_REPO_URL    clone this URL instead of `gh repo clone blissbase`
#   WHATSAPP2SQLITE_TARGET_DIR  live directory (default: $HOME/whatsapp2sqlite)
#   WHATSAPP2SQLITE_CLONE_DIR   sparse clone (default: $HOME/.local/share/blissbase-whatsapp2sqlite)
#   WHATSAPP2SQLITE_SYSTEMD_DIR systemd user unit dir (default: $HOME/.config/systemd/user)

set -euo pipefail

# From a Mac, send this script to the Linux host and run it there.
# The server executes this copy, not whatever deploy script is already installed.
if [ "$(uname -s)" = "Darwin" ]; then
    printf '%s\n' "Running deploy on remote server..."
    # shellcheck disable=SC2029
    exec ssh walter@waltersbox "cd \"\$HOME\" && WHATSAPP2SQLITE_ON_HOST=1 bash -s$(printf ' %q' "$@")" < "$0"
fi

GITHUB_REPO="blissbase"
SERVICE_NAME="whatsapp2sqlite"
REPO_URL="${WHATSAPP2SQLITE_REPO_URL:-}"
TARGET_DIR="${WHATSAPP2SQLITE_TARGET_DIR:-$HOME/whatsapp2sqlite}"
CLONE_DIR="${WHATSAPP2SQLITE_CLONE_DIR:-$HOME/.local/share/blissbase-whatsapp2sqlite}"
SYSTEMD_USER_DIR="${WHATSAPP2SQLITE_SYSTEMD_DIR:-$HOME/.config/systemd/user}"
MIGRATE=0
BRANCH=""
TEMPS=()
LAST_TEMP=""
CLEANING=0

if [ -t 1 ]; then
    GREEN=$'\033[0;32m'
    YELLOW=$'\033[1;33m'
    RED=$'\033[0;31m'
    NC=$'\033[0m'
else
    GREEN=""
    YELLOW=""
    RED=""
    NC=""
fi

log_info() {
    printf '%s\n' "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    printf '%s\n' "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    printf '%s\n' "${RED}[ERROR]${NC} $*" >&2
}

die() {
    log_error "$1"
    exit 1
}

usage() {
    cat <<'EOF'
Usage: deployWhatsapp2Sqlite.sh [--migrate] [branch]

  --migrate   Required the first time ~/whatsapp2sqlite already has files
              and no deploy clone exists. Keeps every untracked file.
              Does not delete anything.

  branch      Remote branch to deploy. Default: the repository default branch.

From a Mac this SSHs to walter@waltersbox and runs there.
EOF
}

remove_temp() {
    local f="$1"
    local base dir
    [ -n "$f" ] || return 0
    base=$(basename -- "$f")
    dir=$(dirname -- "$f")
    case "$base" in
        .whatsapp2sqlite.build.*) ;;
        *)
            if [ "$CLEANING" -eq 0 ]; then
                die "Internal error: refusing to delete $f"
            fi
            log_error "Internal error: refusing to delete $f"
            return 0
            ;;
    esac
    case "$dir" in
        /tmp|"$TARGET_DIR") ;;
        *)
            if [ "$CLEANING" -eq 0 ]; then
                die "Internal error: refusing to delete $f"
            fi
            log_error "Internal error: refusing to delete $f"
            return 0
            ;;
    esac
    if [ -e "$f" ] && [ ! -f "$f" ]; then
        if [ "$CLEANING" -eq 0 ]; then
            die "Internal error: temp path is not a file: $f"
        fi
        log_error "Internal error: temp path is not a file: $f"
        return 0
    fi
    rm -f -- "$f"
}

cleanup_temps() {
    local status=$?
    local f
    CLEANING=1
    if [ "${#TEMPS[@]}" -gt 0 ]; then
        for f in "${TEMPS[@]}"; do
            remove_temp "$f" || true
        done
    fi
    exit "$status"
}

trap cleanup_temps EXIT

# Sets LAST_TEMP. Must be called directly, not in a command substitution,
# so the path is recorded in TEMPS in this shell.
make_temp() {
    local dir="$1"
    local f
    f=$(mktemp "$dir/.whatsapp2sqlite.build.XXXXXX")
    TEMPS+=("$f")
    LAST_TEMP=$f
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --migrate)
                MIGRATE=1
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            --)
                shift
                break
                ;;
            -*)
                die "Unknown option: $1 (see --help)"
                ;;
            *)
                if [ -n "$BRANCH" ]; then
                    die "Unexpected extra argument: $1"
                fi
                BRANCH="$1"
                shift
                ;;
        esac
    done
    if [ "$#" -gt 0 ]; then
        die "Unexpected extra argument: $1"
    fi
}

# Runtime paths are never copied from git and never deleted.
is_runtime_rel() {
    local rel="$1"
    case "$rel" in
        whatsapp2sqlite|whatsapp2sqlite.prev|whatsapp2sqlite.failed)
            return 0
            ;;
        .whatsapp2sqlite.build.*)
            return 0
            ;;
        config.jsonc|notify.env|.notify-incident.json|group_contacts_phone_numbers.txt)
            return 0
            ;;
        .notify-incident-*.tmp)
            return 0
            ;;
        media|media/*)
            return 0
            ;;
        *.sqlite|*.sqlite-*|*.sqlite*)
            return 0
            ;;
        */config.jsonc|*/notify.env|*/.notify-incident.json|*/group_contacts_phone_numbers.txt)
            return 0
            ;;
        */.notify-incident-*.tmp|*/media|*/media/*)
            return 0
            ;;
    esac
    return 1
}

# Files this script itself is allowed to replace.
is_deploy_owned() {
    case "$1" in
        whatsapp2sqlite|whatsapp2sqlite.prev|whatsapp2sqlite.failed|.whatsapp2sqlite.build.*)
            return 0
            ;;
    esac
    return 1
}

is_safe_rel() {
    local rel="$1"
    local part rest
    if [ -z "$rel" ] || [ "$rel" = "." ]; then
        return 1
    fi
    case "$rel" in
        /*|..|../*|*/../*|*/..|*$'\n'*)
            return 1
            ;;
    esac
    rest="$rel"
    while [ -n "$rest" ]; do
        part=${rest%%/*}
        if [ -z "$part" ] || [ "$part" = "." ] || [ "$part" = ".." ]; then
            return 1
        fi
        case "$rest" in
            */*) rest=${rest#*/} ;;
            *) rest="" ;;
        esac
    done
    return 0
}

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Required command not found: $1"
    fi
}

need_bash() {
    if [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
        die "bash 4.4 or newer is required (found ${BASH_VERSION})"
    fi
}

need_git() {
    local ver major minor rest
    ver=$(git version | awk '{print $3}')
    major=${ver%%.*}
    rest=${ver#*.}
    minor=${rest%%.*}
    if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 25 ]; }; then
        die "git 2.25 or newer is required for sparse-checkout (found $ver)"
    fi
}

normalize_existing_parent() {
    local path="$1"
    local parent base
    parent=$(dirname -- "$path")
    base=$(basename -- "$path")
    if [ ! -d "$parent" ]; then
        die "Parent directory does not exist: $parent"
    fi
    parent=$(cd "$parent" && pwd)
    printf '%s/%s\n' "$parent" "$base"
}

reject_bad_path() {
    local path="$1"
    local label="$2"
    if [[ "$path" == *[[:space:]]* || "$path" == *$'\n'* || "$path" == *%* || "$path" == *\\* || "$path" == *'"'* ]]; then
        die "$label contains whitespace or a character that is unsafe in a systemd unit: $path"
    fi
}

target_nonempty() {
    local found
    [ -d "$TARGET_DIR" ] || return 1
    found=$(find "$TARGET_DIR" -mindepth 1 -print -quit)
    [ -n "$found" ]
}

require_migrate_if_legacy() {
    if [ "$MIGRATE" -eq 1 ]; then
        if target_nonempty; then
            log_info "Adopting existing directory $TARGET_DIR"
            log_info "Untracked files stay in place. This script does not delete files there."
        else
            log_info "--migrate set and $TARGET_DIR is empty or missing"
        fi
        return 0
    fi
    if target_nonempty && [ ! -d "$CLONE_DIR/.git" ]; then
        die "Existing installation at $TARGET_DIR has files, and there is no deploy clone yet. Nothing was changed or deleted. Re-run with --migrate to adopt it in place: deployWhatsapp2Sqlite.sh --migrate"
    fi
}

verify_origin() {
    local actual expected actual_canon
    actual=$(git -C "$CLONE_DIR" remote get-url origin)
    if [ -n "$REPO_URL" ]; then
        if [ -d "$REPO_URL" ]; then
            expected=$(cd "$REPO_URL" && pwd -P)
            if [ -d "$actual" ]; then
                actual_canon=$(cd "$actual" && pwd -P)
            else
                actual_canon="$actual"
            fi
            if [ "$actual_canon" != "$expected" ]; then
                die "Clone origin is $actual, expected $REPO_URL. Refusing to delete or reuse $CLONE_DIR."
            fi
            return 0
        fi
        if [ "$actual" != "$REPO_URL" ]; then
            die "Clone origin is $actual, expected $REPO_URL. Refusing to delete or reuse $CLONE_DIR."
        fi
        return 0
    fi
    case "$actual" in
        git@github.com:*/blissbase|git@github.com:*/blissbase.git|\
            https://github.com/*/blissbase|https://github.com/*/blissbase.git|\
            ssh://git@github.com/*/blissbase|ssh://git@github.com/*/blissbase.git)
            ;;
        *)
            die "Clone origin $actual is not a GitHub blissbase checkout. Refusing to delete or reuse $CLONE_DIR."
            ;;
    esac
}

sparse_is_whatsapp2sqlite() {
    local list
    if ! list=$(git -C "$CLONE_DIR" sparse-checkout list 2>/dev/null); then
        return 1
    fi
    list=$(printf '%s\n' "$list" | sed '/^$/d')
    [ "$list" = "whatsapp2sqlite" ] || [ "$list" = "whatsapp2sqlite/" ]
}

ensure_clone() {
    local parent
    if [ -e "$CLONE_DIR" ]; then
        if [ ! -d "$CLONE_DIR/.git" ]; then
            die "$CLONE_DIR exists and is not a git repository. Refusing to delete it. Move it aside if it is leftover. $TARGET_DIR was not modified."
        fi
        verify_origin
        if ! sparse_is_whatsapp2sqlite; then
            die "Clone at $CLONE_DIR is not a sparse checkout of only whatsapp2sqlite/. Refusing to change it, because that can remove files from the clone worktree. Move the directory aside. $TARGET_DIR was not modified."
        fi
        return 0
    fi
    parent=$(dirname -- "$CLONE_DIR")
    mkdir -p -- "$parent"
    log_info "Cloning into $CLONE_DIR (sparse checkout of whatsapp2sqlite/)..."
    if [ -n "$REPO_URL" ]; then
        git clone --sparse -- "$REPO_URL" "$CLONE_DIR"
    else
        gh repo clone "$GITHUB_REPO" "$CLONE_DIR" -- --sparse
    fi
    verify_origin
}

assert_no_extra_clone_files() {
    local status_out line kind
    status_out=$(git -C "$CLONE_DIR" status --porcelain=v1 --ignored --untracked-files=all)
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        kind=${line:0:2}
        case "$kind" in
            '??'|'!!')
                die "Deploy clone has extra files ($line). Refusing to reset or delete them. Move them out of $CLONE_DIR and retry. $TARGET_DIR was not modified."
                ;;
        esac
    done <<< "$status_out"
}

assert_tree_has_no_runtime() {
    local rev="$1"
    local list_file path rel
    make_temp /tmp
    list_file=$LAST_TEMP
    if ! git -C "$CLONE_DIR" ls-tree -r -z --name-only "$rev" > "$list_file"; then
        die "git ls-tree failed for $rev"
    fi
    while IFS= read -r -d '' path; do
        case "$path" in
            whatsapp2sqlite/*) ;;
            *) continue ;;
        esac
        rel=${path#whatsapp2sqlite/}
        if ! is_safe_rel "$rel"; then
            die "Refusing unsafe path in $rev: $path"
        fi
        if is_runtime_rel "$rel"; then
            die "Refusing to deploy: $path is tracked, but that path is runtime state. Nothing was deleted. $TARGET_DIR was not modified."
        fi
    done < "$list_file"
}

update_clone() {
    local default_ref
    log_info "Updating deploy clone $CLONE_DIR"
    git -C "$CLONE_DIR" sparse-checkout set whatsapp2sqlite
    git -C "$CLONE_DIR" fetch origin
    if [ -z "$BRANCH" ]; then
        git -C "$CLONE_DIR" remote set-head origin --auto >/dev/null
        default_ref=$(git -C "$CLONE_DIR" symbolic-ref --short refs/remotes/origin/HEAD)
        BRANCH=${default_ref#origin/}
    fi
    if [ -z "$BRANCH" ]; then
        die "Could not determine the default branch. Pass it as an argument."
    fi
    if ! git -C "$CLONE_DIR" rev-parse --verify --quiet "origin/${BRANCH}^{commit}" >/dev/null; then
        die "Remote branch not found: $BRANCH"
    fi
    assert_tree_has_no_runtime "origin/$BRANCH"
    assert_no_extra_clone_files
    log_info "Checking out origin/$BRANCH in the deploy clone"
    if ! git -C "$CLONE_DIR" checkout --detach "origin/$BRANCH"; then
        log_warn "git checkout could not switch while the clone had local edits. Resetting tracked files only."
        # Untracked and ignored files are not deleted. assert_no_extra_clone_files
        # already aborted if any of those exist, so reset cannot overwrite them either.
        git -C "$CLONE_DIR" reset --hard "origin/$BRANCH"
    else
        git -C "$CLONE_DIR" reset --hard --quiet "origin/$BRANCH"
    fi
    log_info "Clone is at $(git -C "$CLONE_DIR" rev-parse --short HEAD) (origin/$BRANCH)"
}

assert_runtime_gitignored() {
    local path
    local paths=(
        "whatsapp2sqlite/whatsapp.sqlite"
        "whatsapp2sqlite/whatsapp.sqlite-wal"
        "whatsapp2sqlite/whatsapp.sqlite-shm"
        "whatsapp2sqlite/config.jsonc"
        "whatsapp2sqlite/notify.env"
        "whatsapp2sqlite/.notify-incident.json"
        "whatsapp2sqlite/.notify-incident-example.tmp"
        "whatsapp2sqlite/media/example.bin"
        "whatsapp2sqlite/group_contacts_phone_numbers.txt"
        "whatsapp2sqlite/whatsapp copy.sqlite"
        "whatsapp2sqlite/whatsapp copy.sqlite-wal"
        "whatsapp2sqlite/whatsapp copy.sqlite-shm"
        "whatsapp2sqlite/whatsapp2sqlite"
        "whatsapp2sqlite/whatsapp2sqlite.prev"
        "whatsapp2sqlite/whatsapp2sqlite.failed"
    )
    for path in "${paths[@]}"; do
        if ! git -C "$CLONE_DIR" check-ignore -q -- "$path"; then
            die "Runtime path is not gitignored: $path. Fix whatsapp2sqlite/.gitignore. $TARGET_DIR was not modified."
        fi
    done
}

declare -gA TRACKED_SET=()
declare -ga TRACKED_REL=()

collect_tracked() {
    local list_file path rel
    make_temp /tmp
    list_file=$LAST_TEMP
    if ! git -C "$CLONE_DIR" ls-files -z -- whatsapp2sqlite > "$list_file"; then
        die "git ls-files failed"
    fi
    TRACKED_REL=()
    while IFS= read -r -d '' path; do
        case "$path" in
            whatsapp2sqlite/*) ;;
            *)
                die "Unexpected tracked path outside whatsapp2sqlite/: $path"
                ;;
        esac
        rel=${path#whatsapp2sqlite/}
        if ! is_safe_rel "$rel"; then
            die "Refusing unsafe tracked path: $path"
        fi
        if is_runtime_rel "$rel"; then
            die "Refusing to deploy: $path is tracked, but that path is runtime state. Nothing was deleted."
        fi
        TRACKED_SET["$rel"]=1
        TRACKED_REL+=("$rel")
    done < "$list_file"
    if [ "${#TRACKED_REL[@]}" -eq 0 ]; then
        die "Clone has no tracked files under whatsapp2sqlite/"
    fi
}

is_tracked_rel() {
    local key="$1"
    [[ -n "${TRACKED_SET[$key]+x}" ]]
}

log_kept_files() {
    local n=0 path rel
    local name
    local names=(
        "whatsapp.sqlite"
        "whatsapp.sqlite-wal"
        "whatsapp.sqlite-shm"
        "config.jsonc"
        "notify.env"
        ".notify-incident.json"
        "group_contacts_phone_numbers.txt"
        "whatsapp copy.sqlite"
        "whatsapp copy.sqlite-wal"
        "whatsapp copy.sqlite-shm"
    )
    if [ ! -d "$TARGET_DIR" ]; then
        log_info "Runtime directory does not exist yet; it will be created"
        return 0
    fi
    for name in "${names[@]}"; do
        if [ -e "$TARGET_DIR/$name" ]; then
            log_info "Keeping $name"
        fi
    done
    if [ -d "$TARGET_DIR/media" ]; then
        log_info "Keeping media/"
    fi
    while IFS= read -r -d '' path; do
        rel=${path#./}
        if is_deploy_owned "$rel"; then
            continue
        fi
        if is_tracked_rel "$rel"; then
            continue
        fi
        n=$((n + 1))
    done < <(cd "$TARGET_DIR" && find . -type f -print0)
    log_info "Leaving $n untracked file(s) in place. Nothing in $TARGET_DIR is deleted."
}

run_tests() {
    log_info "Running tests in the clone..."
    if ! (
        cd "$CLONE_DIR/whatsapp2sqlite" || exit 1
        GOFLAGS='' go test -mod=readonly ./... -count=1
    ); then
        die "Tests failed. The service was not stopped and $TARGET_DIR was not modified."
    fi
    log_info "Tests passed"
}

verify_elf() {
    local f="$1"
    local magic
    if [ ! -f "$f" ]; then
        die "Build output is missing: $f"
    fi
    if [ ! -s "$f" ]; then
        die "Build output is empty: $f"
    fi
    magic=$(od -An -t x1 -N 4 -- "$f" | tr -d ' \n')
    if [ "$magic" != "7f454c46" ]; then
        die "Build output is not an ELF executable (magic ${magic:-empty}). Build ./cmd/whatsapp2sqlite, not the package root. The service was not stopped."
    fi
    chmod 755 -- "$f"
}

build_binary() {
    local out="$1"
    if [ ! -f "$CLONE_DIR/whatsapp2sqlite/go.mod" ]; then
        die "go.mod is missing in the clone"
    fi
    if [ ! -f "$CLONE_DIR/whatsapp2sqlite/cmd/whatsapp2sqlite/main.go" ]; then
        die "Entrypoint whatsapp2sqlite/cmd/whatsapp2sqlite/main.go is missing"
    fi
    log_info "Building ./cmd/whatsapp2sqlite to a temp file..."
    if ! (
        cd "$CLONE_DIR/whatsapp2sqlite" || exit 1
        GOFLAGS='' go build -mod=readonly -o "$out" ./cmd/whatsapp2sqlite
    ); then
        die "Build failed. The service was not stopped and $TARGET_DIR was not modified."
    fi
    verify_elf "$out"
    log_info "Build successful: $out"
}

prepare_dest_dir() {
    local dir="$1"
    local rel acc part
    local parts=()
    if [ "$dir" = "$TARGET_DIR" ]; then
        return 0
    fi
    rel=${dir#"$TARGET_DIR"/}
    acc="$TARGET_DIR"
    local IFS=/
    read -ra parts <<< "$rel"
    for part in "${parts[@]}"; do
        [ -n "$part" ] || continue
        acc="$acc/$part"
        if [ -L "$acc" ]; then
            die "Refusing to write through symlink $acc"
        fi
        if [ -e "$acc" ] && [ ! -d "$acc" ]; then
            die "Refusing to replace non-directory $acc"
        fi
    done
    mkdir -p -- "$dir"
}

sync_tracked_files() {
    local rel src dest
    log_info "Copying ${#TRACKED_REL[@]} tracked file(s) into $TARGET_DIR"
    for rel in "${TRACKED_REL[@]}"; do
        if is_runtime_rel "$rel"; then
            die "Refusing to write runtime path $rel"
        fi
        src="$CLONE_DIR/whatsapp2sqlite/$rel"
        dest="$TARGET_DIR/$rel"
        if [ -L "$src" ]; then
            die "Refusing to copy symlink from the clone: $src"
        fi
        if [ ! -f "$src" ]; then
            die "Tracked file is missing in the clone: $src"
        fi
        if [ -L "$dest" ]; then
            die "Refusing to replace symlink $dest"
        fi
        if [ -d "$dest" ]; then
            die "Refusing to replace directory $dest with a file"
        fi
        if [ -e "$dest" ] && [ ! -f "$dest" ]; then
            die "Refusing to replace non-regular file $dest"
        fi
        prepare_dest_dir "$(dirname -- "$dest")"
        cp -p -- "$src" "$dest"
    done
}

write_unit() {
    local service_file="$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"
    mkdir -p -- "$SYSTEMD_USER_DIR"
    cat > "$service_file" << EOF
[Unit]
Description=WhatsApp to SQLite Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=-${TARGET_DIR}/notify.env
ExecStart=${TARGET_DIR}/whatsapp2sqlite
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
    log_info "Service file written: $service_file"
}

service_is_active() {
    systemctl --user is-active --quiet "$SERVICE_NAME"
}

rollback_binary() {
    local live="$TARGET_DIR/whatsapp2sqlite"
    local prev="$TARGET_DIR/whatsapp2sqlite.prev"
    local failed="$TARGET_DIR/whatsapp2sqlite.failed"
    if [ ! -f "$prev" ]; then
        if [ -e "$live" ]; then
            mv -f -- "$live" "$failed"
        fi
        log_error "No whatsapp2sqlite.prev to restore"
        return 1
    fi
    if [ -e "$live" ]; then
        mv -f -- "$live" "$failed"
    fi
    cp -a -- "$prev" "$live"
    chmod 755 -- "$live"
    log_warn "Restored previous binary from whatsapp2sqlite.prev"
}

install_binary_and_restart() {
    local built="$1"
    local live="$TARGET_DIR/whatsapp2sqlite"
    local prev="$TARGET_DIR/whatsapp2sqlite.prev"
    local staged backup

    make_temp "$TARGET_DIR"
    staged=$LAST_TEMP
    cp -a -- "$built" "$staged"
    verify_elf "$staged"

    backup=""
    if [ -e "$live" ]; then
        if [ -L "$live" ] || [ ! -f "$live" ]; then
            die "Existing $live is not a regular file. The service was not stopped."
        fi
        make_temp "$TARGET_DIR"
        backup=$LAST_TEMP
        cp -a -- "$live" "$backup"
    fi

    write_unit
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME"

    if service_is_active; then
        log_info "Stopping $SERVICE_NAME"
        if ! systemctl --user stop "$SERVICE_NAME"; then
            die "Could not stop $SERVICE_NAME. The live binary was not replaced."
        fi
    else
        log_info "$SERVICE_NAME is not running"
    fi

    if [ -n "$backup" ]; then
        mv -f -- "$backup" "$prev"
        log_info "Previous binary saved: $prev"
    fi
    if ! mv -f -- "$staged" "$live"; then
        log_error "Could not install the new binary."
        systemctl --user start "$SERVICE_NAME" || true
        die "Binary install failed. Attempted to start the existing binary again."
    fi
    chmod 755 -- "$live"

    log_info "Starting $SERVICE_NAME"
    if ! systemctl --user start "$SERVICE_NAME"; then
        log_error "Start failed. Restoring the previous binary."
        if ! rollback_binary; then
            systemctl --user start "$SERVICE_NAME" || true
            die "New binary did not start and there is no previous binary to restore."
        fi
        if ! systemctl --user start "$SERVICE_NAME"; then
            die "Previous binary failed to start. The service is stopped. Backup: $prev"
        fi
        die "New binary did not start. Restored the previous binary and started it."
    fi
    sleep 2
    if ! service_is_active; then
        log_error "Service is not active after start. Restoring the previous binary."
        systemctl --user stop "$SERVICE_NAME" || true
        if ! rollback_binary; then
            die "New binary did not stay running and there is no previous binary to restore."
        fi
        systemctl --user start "$SERVICE_NAME" || true
        systemctl --user status "$SERVICE_NAME" --no-pager || true
        die "New binary did not stay running. Restored the previous binary."
    fi
    systemctl --user status "$SERVICE_NAME" --no-pager || true
}

check_prereqs() {
    need_bash
    need_cmd git
    need_cmd go
    need_cmd systemctl
    need_cmd mktemp
    need_cmd od
    need_git
    if [ -z "$REPO_URL" ]; then
        need_cmd gh
        log_info "Checking GitHub CLI..."
        if ! gh auth status >/dev/null 2>&1; then
            die "GitHub CLI is not authenticated. Run 'gh auth login' as the deploy user."
        fi
        log_info "GitHub CLI is ready"
    fi
    log_info "Go version: $(go version)"
}

separate_dirs() {
    case "$TARGET_DIR" in
        "$CLONE_DIR"|"$CLONE_DIR"/*)
            die "Runtime directory must not be inside the deploy clone ($CLONE_DIR)"
            ;;
    esac
    case "$CLONE_DIR" in
        "$TARGET_DIR"|"$TARGET_DIR"/*)
            die "Deploy clone must not be inside the runtime directory ($TARGET_DIR)"
            ;;
    esac
    if [ -e "$TARGET_DIR/.git" ]; then
        die "$TARGET_DIR contains .git. Refusing to deploy into a git worktree so git cannot touch runtime files. Nothing was deleted."
    fi
}

main() {
    export GIT_TERMINAL_PROMPT=0
    parse_args "$@"
    check_prereqs

    mkdir -p -- "$(dirname -- "$CLONE_DIR")"
    CLONE_DIR=$(normalize_existing_parent "$CLONE_DIR")
    if [ -d "$(dirname -- "$TARGET_DIR")" ]; then
        TARGET_DIR=$(normalize_existing_parent "$TARGET_DIR")
    fi
    reject_bad_path "$TARGET_DIR" "Runtime directory"
    reject_bad_path "$CLONE_DIR" "Deploy clone"
    separate_dirs

    log_info "Runtime directory: $TARGET_DIR"
    log_info "Deploy clone: $CLONE_DIR"

    require_migrate_if_legacy
    ensure_clone
    update_clone
    assert_runtime_gitignored
    collect_tracked

    local built
    run_tests
    make_temp /tmp
    built=$LAST_TEMP
    build_binary "$built"

    mkdir -p -- "$TARGET_DIR"
    log_kept_files
    sync_tracked_files
    install_binary_and_restart "$built"

    log_info "Deployment completed successfully."
    log_info "Rollback: systemctl --user stop $SERVICE_NAME && cp -a $TARGET_DIR/whatsapp2sqlite.prev $TARGET_DIR/whatsapp2sqlite && systemctl --user start $SERVICE_NAME"
    log_info "Status: systemctl --user status $SERVICE_NAME"
    log_info "Logs: journalctl --user -u $SERVICE_NAME -f"
}

main "$@"
