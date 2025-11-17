param(
  [string]$Message = "chore: update"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Try to use gpush.sh via Git Bash if available, otherwise use PowerShell implementation
$GitBash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $GitBash)) {
    $GitBash = "C:\Program Files (x86)\Git\bin\bash.exe"
}

if (Test-Path $GitBash) {
    # Use gpush.sh via Git Bash
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $GpushSh = Join-Path $ScriptDir "gpush.sh"
    if (Test-Path $GpushSh) {
        $UnixPath = $ScriptDir -replace '\\', '/' -replace '^C:', '/c' -replace '^c:', '/c'
        & $GitBash -c "cd '$UnixPath' && ./gpush.sh '$Message'"
        exit $LASTEXITCODE
    }
}

# Fallback to PowerShell implementation
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

