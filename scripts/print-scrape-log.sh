#!/usr/bin/env bash
# Prints scrape-logs/<source>.log and exits 1 when that source failed.
# Usage:
#   bash scripts/print-scrape-log.sh heilnetz
#   bash scripts/print-scrape-log.sh --all   # all sources as collapsible GHA groups
set -euo pipefail

log_dir="${LOG_DIR:-scrape-logs}"

print_one() {
  local source_name="$1"
  local log_file="$log_dir/$source_name.log"
  local status_file="$log_dir/$source_name.status"

  if [ -f "$log_file" ]; then
    cat "$log_file"
  else
    echo "::notice::No log for $source_name (not scraped this run)"
    return 0
  fi

  if [ -f "$status_file" ] && grep -qx fail "$status_file"; then
    echo "::error::$source_name scrape failed"
    return 1
  fi
  return 0
}

print_all() {
  if [ ! -d "$log_dir" ]; then
    echo "::notice::No $log_dir directory"
    return 0
  fi

  shopt -s nullglob
  local status_files=("$log_dir"/*.status)
  if [ ${#status_files[@]} -eq 0 ]; then
    echo "::notice::No per-source scrape logs found"
    return 0
  fi

  local failed=0
  local status_file source_name
  for status_file in "${status_files[@]}"; do
    source_name=$(basename "$status_file" .status)
    echo "::group::log $source_name"
    if ! print_one "$source_name"; then
      failed=1
    fi
    echo "::endgroup::"
  done
  return "$failed"
}

if [ "${1:-}" = "--all" ]; then
  print_all
elif [ -n "${1:-${SOURCE:-}}" ]; then
  print_one "${1:-$SOURCE}"
else
  echo "::error::Missing source name (arg or SOURCE env), or pass --all"
  exit 1
fi
