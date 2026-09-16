#!/bin/bash
# Manual fallback publisher for deterministic network diagnostic fixtures.
set -e
REPO='pioner22/MacOS'
TAG='diagnostic-fixtures-v1'
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
WORK="${TMPDIR:-/tmp}/macos-network-fixtures-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT INT TERM

for c in curl python3 gh sha256sum; do
  command -v "$c" >/dev/null 2>&1 || { echo "Missing command: $c" >&2; exit 1; }
done

echo 'Fetching fixture generator and manifests...'
curl -fsSL "$BASE/tools/generate_network_fixtures.py" -o "$WORK/generate.py"
curl -fsSL "$BASE/network-fixtures.sha256" -o "$WORK/network-fixtures.sha256"
curl -fsSL "$BASE/network-fixtures.tsv" -o "$WORK/network-fixtures.tsv"

mkdir -p "$WORK/out"
FIXTURE_OUT="$WORK/out" python3 "$WORK/generate.py"
(
  cd "$WORK/out"
  sha256sum -c "$WORK/network-fixtures.sha256"
)
cp "$WORK/network-fixtures.sha256" "$WORK/out/"
cp "$WORK/network-fixtures.tsv" "$WORK/out/"

if ! gh auth status >/dev/null 2>&1; then
  echo 'GitHub CLI is not authenticated. Run: gh auth login' >&2
  exit 1
fi

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$REPO" \
    --title 'MacBook Diagnostic Network Fixtures v1' \
    --notes 'Deterministic 1/8/32/128/512 MiB assets for network/download integrity testing.'
fi

gh release upload "$TAG" "$WORK"/out/* --repo "$REPO" --clobber

echo "Published: https://github.com/$REPO/releases/tag/$TAG"
