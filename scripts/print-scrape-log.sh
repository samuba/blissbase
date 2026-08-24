#!/usr/bin/env bash
# Prints scrape-logs/<source>.log and exits 1 when that source failed.
# Usage: SOURCE=heilnetz bash scripts/print-scrape-log.sh
#    or: bash scripts/print-scrape-log.sh heilnetz
set -euo pipefail

source_name="${1:-${SOURCE:-}}"
if [ -z "$source_name" ]; then
  echo "::error::Missing source name (arg or SOURCE env)"
  exit 1
fi

log_dir="${LOG_DIR:-scrape-logs}"
log_file="$log_dir/$source_name.log"
status_file="$log_dir/$source_name.status"

if [ -f "$log_file" ]; then
  cat "$log_file"
else
  echo "::notice::No log for $source_name (not scraped this run)"
  exit 0
fi

if [ -f "$status_file" ] && grep -qx fail "$status_file"; then
  echo "::error::$source_name scrape failed"
  exit 1
fi
