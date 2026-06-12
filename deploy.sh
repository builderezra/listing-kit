#!/usr/bin/env bash
# Deploy Listing Kit to GitHub Pages.
# Usage:
#   GITHUB_USER=builderezra GITHUB_TOKEN=ghp_xxx REPO=listing-kit bash deploy.sh
#
# Needs a GitHub Personal Access Token with "repo" scope (classic),
# or a fine-grained token with Contents + Pages + Administration (read/write).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${GITHUB_USER:?Set GITHUB_USER (your GitHub username)}"
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN (a personal access token)}"
REPO="${REPO:-listing-kit}"
API="https://api.github.com"
AUTH="Authorization: Bearer $GITHUB_TOKEN"
JSON="Accept: application/vnd.github+json"

# Make sure there is a commit to push.
if ! git -C "$DIR" rev-parse HEAD >/dev/null 2>&1; then
  git -C "$DIR" add -A
  git -C "$DIR" commit -q -m "Listing Kit — initial site"
fi

echo "→ Creating repo '$REPO' (skipped if it already exists)…"
curl -s -o /dev/null -X POST -H "$AUTH" -H "$JSON" \
  "$API/user/repos" \
  -d "{\"name\":\"$REPO\",\"private\":false,\"description\":\"Listing Kit — marketing copy for every listing\"}" || true

echo "→ Pushing site…"
# Push with the token inline so it is NOT stored in .git/config.
git -C "$DIR" push --force "https://$GITHUB_USER:$GITHUB_TOKEN@github.com/$GITHUB_USER/$REPO.git" main:main
# Leave a clean (token-free) remote for future pushes.
git -C "$DIR" remote remove origin 2>/dev/null || true
git -C "$DIR" remote add origin "https://github.com/$GITHUB_USER/$REPO.git"

echo "→ Enabling GitHub Pages…"
curl -s -o /dev/null -X POST -H "$AUTH" -H "$JSON" \
  "$API/repos/$GITHUB_USER/$REPO/pages" \
  -d '{"source":{"branch":"main","path":"/"}}' || true

echo ""
echo "✅ Done. Your permanent site (live in ~1 minute):"
echo "   https://$GITHUB_USER.github.io/$REPO/"
echo ""
echo "To publish future changes: git -C \"$DIR\" add -A && git -C \"$DIR\" commit -m \"update\" && git -C \"$DIR\" push origin main"
