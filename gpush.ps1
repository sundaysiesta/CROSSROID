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
        # Convert Windows path to Unix-style path for Git Bash
        # Example: C:\Users\natsu\デスクトップ\CROSSROID -> /c/Users/natsu/デスクトップ/CROSSROID
        $UnixPath = $ScriptDir -replace '\\', '/'
        if ($UnixPath -match '^([A-Za-z]):') {
            $DriveLetter = $Matches[1].ToLower()
            $UnixPath = $UnixPath -replace '^([A-Za-z]):', "/$DriveLetter"
        }
        
        # Escape single quotes in message for bash
        $EscapedMessage = $Message -replace "'", "'\''"
        
        # Execute gpush.sh via Git Bash
        $Command = "cd '$UnixPath' && ./gpush.sh '$EscapedMessage'"
        try {
            & $GitBash -c $Command
            if ($LASTEXITCODE -eq 0) {
                return
            }
            # If gpush.sh failed, fall through to PowerShell implementation
            Write-Warning "gpush.sh exited with code $LASTEXITCODE, using PowerShell fallback"
        } catch {
            # If there's an error, fall through to PowerShell implementation
            Write-Warning "Failed to execute gpush.sh via Git Bash: $_"
        }
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

