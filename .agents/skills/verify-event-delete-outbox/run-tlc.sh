#!/usr/bin/env bash
# Run TLC on EventDeleteOutbox. Pin: tla2tools from tlaplus v1.8.0 release.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/blissbase-tlc"
JAR="$CACHE_DIR/tla2tools-1.8.0.jar"
EXPECTED_SHA="15d103b7e5617780bcc904c0af12f1ad242e2b345c0301136c5be4588f17edac"
URL="https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"

MODE="${1:-check}" # check | broken
CFG="$DIR/EventDeleteOutbox.cfg"
if [[ "$MODE" == "broken" ]]; then
  CFG="$DIR/EventDeleteOutboxBroken.cfg"
fi

if ! command -v java >/dev/null 2>&1; then
  echo "java is required to run TLC" >&2
  exit 127
fi

mkdir -p "$CACHE_DIR"
if [[ ! -f "$JAR" ]]; then
  echo "Downloading tla2tools 1.8.0 to $JAR"
  curl -fsSL -o "$JAR.partial" "$URL"
  mv "$JAR.partial" "$JAR"
fi

ACTUAL_SHA="$(sha256sum "$JAR" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "SHA256 mismatch for $JAR" >&2
  echo "expected $EXPECTED_SHA" >&2
  echo "got      $ACTUAL_SHA" >&2
  exit 1
fi

META="$DIR/.tlc-states"
mkdir -p "$META"
# -workers auto keeps runs short on CI/dev laptops
# -deadlock: safety-only; finite clock/outbox bounds can stall Next without
# violating LiveImagesPreserved (liveness of drain is out of scope).
exec java -XX:+UseParallelGC -jar "$JAR" \
  -config "$CFG" \
  -workers auto \
  -deadlock \
  -metadir "$META" \
  -cleanup \
  "$DIR/EventDeleteOutbox.tla"
)
