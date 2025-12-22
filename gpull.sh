#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gpull.sh
# Pulls latest changes from GitHub and updates local repository

echo "Fetching latest changes from GitHub..."
git fetch origin

# Detect current branch
branch=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $branch"

# Check if there are local changes that would be overwritten
if ! git diff-index --quiet HEAD --; then
    echo "Warning: You have uncommitted changes:"
    git status --short
    read -p "Do you want to stash them before pulling? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stashing local changes..."
        git stash
        should_stash_pop=true
    else
        echo "Aborting pull to preserve local changes."
        exit 1
    fi
else
    should_stash_pop=false
fi

# Pull latest changes
echo "Pulling latest changes from origin/$branch ..."
git pull origin "$branch"

# Restore stashed changes if any
if [ "$should_stash_pop" = true ]; then
    echo "Restoring stashed changes..."
    git stash pop || {
        echo "Warning: There were conflicts when restoring stashed changes. Please resolve them manually."
    }
fi

echo "Done. Local repository is now up to date with GitHub."

