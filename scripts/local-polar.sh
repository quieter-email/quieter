#!/usr/bin/env bash
set -eu

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if ! command -v polar >/dev/null 2>&1; then
  export PATH="$HOME/.local/bin:$PATH"
fi
if ! command -v polar >/dev/null 2>&1; then
  echo "Install the official Polar CLI in WSL first. See docs/development.md."
  exit 1
fi

python3 "$script_dir/local-polar-relay.py" &
relay_pid=$!
trap 'kill "$relay_pid" 2>/dev/null || true' EXIT
echo "Select Sandbox, then your development organization."
polar listen http://localhost:4300/api/auth/polar/webhooks
