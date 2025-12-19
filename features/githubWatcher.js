const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const REPO_OWNER = 'sundaysiesta';
const REPO_NAME = 'CROSSROID';
const TARGET_CHANNEL_ID = '1449926885160259677';
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

        // New commit detected
        console.log(`[GitHubWatcher] New commit detected: ${currentSha}`);

        const message = latestCommit.commit.message;
        const authorName = latestCommit.commit.author.name;
        const authorUrl = latestCommit.author ? latestCommit.author.html_url : null;
        const commitUrl = latestCommit.html_url;
        const timestamp = latestCommit.commit.author.date;

        lastKnownSha = currentSha;
        saveState(currentSha);

        const channel = client.channels.cache.get(TARGET_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle(`🔨 New Commit to ${REPO_NAME}`)
                .setURL(commitUrl)
                .setAuthor({ name: authorName, url: authorUrl || undefined, iconURL: latestCommit.author ? latestCommit.author.avatar_url : undefined })
                .setDescription(`\`\`\`\n${message}\n\`\`\``)
                .setColor(0x2b2d31) // GitHub Dark
                .setFooter({ text: `SHA: ${currentSha.substring(0, 7)}` })
                .setTimestamp(new Date(timestamp));

            await channel.send({ embeds: [embed] });
        } else {
            console.warn('[GitHubWatcher] Target channel not found.');
        }

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
