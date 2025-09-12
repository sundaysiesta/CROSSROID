#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gpush.sh "commit message"
# Default commit message: "chore: update"

commit_msg=${1:-"chore: update"}

# Stage all changes
git add -A

# Commit if there are staged changes
if git diff --cached --quiet; then
  echo "No changes to commit. Skipping commit."
else
  git commit -m "$commit_msg"
fi

# Detect current branch and push
branch=$(git rev-parse --abbrev-ref HEAD)
echo "Pushing to origin/$branch ..."
git push origin "$branch"
echo "Done."



