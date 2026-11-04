#!/usr/bin/env bash
# Prompt once for the Blissbase KeePass master password, then run the given command.
set -euo pipefail

if [[ -z "${KP_PASSWORD:-}" ]]; then
	if [[ ! -t 0 ]]; then
		echo "KP_PASSWORD is required (no TTY to prompt)." >&2
		exit 1
	fi
	read -r -s -p "KeePass master password: " KP_PASSWORD
	echo
	if [[ -z "${KP_PASSWORD}" ]]; then
		echo "Password required." >&2
		exit 1
	fi
	export KP_PASSWORD
fi

exec "$@"
