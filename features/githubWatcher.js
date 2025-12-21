const fs = require('fs');
const path = require('path');

const REPO_OWNER = 'sundaysiesta';
const REPO_NAME = 'CROSSROID';
const STATE_FILE = path.join(__dirname, '..', 'github_last_sha.json');
const INTERVAL_MS = 2 * 60 * 1000; // 2 Minutes (Safe for 60 req/hr limit)

let lastKnownSha = null;

// Load state on startup
if (fs.existsSync(STATE_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        lastKnownSha = data.sha;
    } catch (e) {
        console.error('[GitHubWatcher] State load error:', e);
    }
}

async function checkCommits(client) {
    // console.log('[GitHubWatcher] Checking for new commits...');
    try {
        const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=1`);

        if (!response.ok) {
            console.warn(`[GitHubWatcher] API Error: ${response.status} ${response.statusText}`);
            return;
        }

        const data = await response.json();
        // data can be an array (normally) or object if error, but with per_page=1 it should be array of 1
        if (!Array.isArray(data) || data.length === 0) return;

        const latestCommit = data[0];
        const currentSha = latestCommit.sha;

        // First run or same commit
        if (!lastKnownSha) {
            console.log(`[GitHubWatcher] Initial SHA set: ${currentSha}`);
            lastKnownSha = currentSha;
            saveState(currentSha);
            return;
        }

        if (currentSha === lastKnownSha) {
            return; // No new commits
        }

        // New commit detected (only update state, no notification)
        console.log(`[GitHubWatcher] New commit detected: ${currentSha}`);

        lastKnownSha = currentSha;
        saveState(currentSha);

    } catch (error) {
        console.error('[GitHubWatcher] Fetch error:', error);
    }
}

function saveState(sha) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ sha }), 'utf8');
    } catch (e) {
        console.error('[GitHubWatcher] Save error:', e);
    }
}

function startWatcher(client) {
    if (!client) {
        console.error('[GitHubWatcher] Client not provided.');
        return;
    }

    console.log('[GitHubWatcher] Service started.');
    // Initial check immediately
    checkCommits(client);

    // Interval check
    setInterval(() => checkCommits(client), INTERVAL_MS);
}

module.exports = { startWatcher };
