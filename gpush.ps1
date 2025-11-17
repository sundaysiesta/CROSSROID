param(
  [string]$Message = "chore: update"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Stage all changes
git add -A

# Commit only if there are staged changes
if (git diff --cached --quiet) {
  Write-Host "No changes to commit. Skipping commit."
} else {
  git commit -m $Message
}

# Detect current branch and push
$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Pushing to origin/$branch ..."
git push origin $branch
Write-Host "Done."

