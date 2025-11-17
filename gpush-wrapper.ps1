# PowerShell wrapper for gpush.sh
# Usage: ./gpush-wrapper.ps1 "commit message"

param(
  [string]$Message = "chore: update"
)

$GitBash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $GitBash)) {
    $GitBash = "C:\Program Files (x86)\Git\bin\bash.exe"
}

if (-not (Test-Path $GitBash)) {
    Write-Error "Git Bash not found. Please install Git for Windows."
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UnixPath = $ScriptDir -replace '\\', '/' -replace '^C:', '/c' -replace '^c:', '/c'

& $GitBash -c "cd '$UnixPath' && ./gpush.sh '$Message'"

