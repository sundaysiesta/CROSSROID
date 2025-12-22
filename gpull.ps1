Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# Try to use gpull.sh via Git Bash if available, otherwise use PowerShell implementation
$GitBash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $GitBash)) {
    $GitBash = "C:\Program Files (x86)\Git\bin\bash.exe"
}

if (Test-Path $GitBash) {
    # Use gpull.sh via Git Bash
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $GpullSh = Join-Path $ScriptDir "gpull.sh"
    if (Test-Path $GpullSh) {
        # Convert Windows path to Unix-style path for Git Bash
        # Example: C:\Users\natsu\デスクトップ\CROSSROID -> /c/Users/natsu/デスクトップ/CROSSROID
        $UnixPath = $ScriptDir -replace '\\', '/'
        if ($UnixPath -match '^([A-Za-z]):') {
            $DriveLetter = $Matches[1].ToLower()
            $UnixPath = $UnixPath -replace '^([A-Za-z]):', "/$DriveLetter"
        }
        
        # Execute gpull.sh via Git Bash
        $Command = "cd '$UnixPath' && ./gpull.sh"
        try {
            & $GitBash -c $Command
            if ($LASTEXITCODE -eq 0) {
                return
            }
            # If gpull.sh failed, fall through to PowerShell implementation
            Write-Warning "gpull.sh exited with code $LASTEXITCODE, using PowerShell fallback"
        } catch {
            # If there's an error, fall through to PowerShell implementation
            Write-Warning "Failed to execute gpull.sh via Git Bash: $_"
        }
    }
}

# Fallback to PowerShell implementation
Write-Host "Fetching latest changes from GitHub..."
git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to fetch from origin."
    exit 1
}

# Detect current branch
$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Current branch: $branch"

# Check if there are local changes that would be overwritten
$status = git status --porcelain
if ($status) {
    Write-Warning "You have uncommitted changes:"
    Write-Host $status
    $response = Read-Host "Do you want to stash them before pulling? (y/n)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        Write-Host "Stashing local changes..."
        git stash
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to stash changes."
            exit 1
        }
        $shouldStashPop = $true
    } else {
        Write-Host "Aborting pull to preserve local changes."
        exit 1
    }
} else {
    $shouldStashPop = $false
}

# Pull latest changes
Write-Host "Pulling latest changes from origin/$branch ..."
git pull origin $branch
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to pull from origin/$branch"
    if ($shouldStashPop) {
        Write-Host "Restoring stashed changes..."
        git stash pop
    }
    exit 1
}

# Restore stashed changes if any
if ($shouldStashPop) {
    Write-Host "Restoring stashed changes..."
    git stash pop
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "There were conflicts when restoring stashed changes. Please resolve them manually."
    }
}

Write-Host "Done. Local repository is now up to date with GitHub."

