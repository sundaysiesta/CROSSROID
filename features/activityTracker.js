const fs = require('fs');
const path = require('path');
const { MAIN_CHANNEL_ID } = require('../constants');

const DATA_FILE = path.join(__dirname, '../activity_data.json');
// Format: { "userId": { "2024-12-16": 50, "2024-12-15": 10 } }

let activityCache = {};
let isBackfilling = false;

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            activityCache = JSON.parse(raw);
        }
    } catch (e) {
        console.error('Failed to load activity data:', e);
        activityCache = {};
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(activityCache, null, 2));
    } catch (e) {
        console.error('Failed to save activity data:', e);
    }
}

function getTodayKey() {
    // JST Date Key
    const now = new Date();
    const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const y = jst.getFullYear();
    const m = String(jst.getMonth() + 1).padStart(2, '0');
    const d = String(jst.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function backfill(client) {
    if (isBackfilling) return;
    isBackfilling = true;
    console.log('[ActivityTracker] Starting backfill...');

    const channel = client.channels.cache.get(MAIN_CHANNEL_ID);
    if (!channel) {
        console.error('[ActivityTracker] Main channel not found.');
        isBackfilling = false;
        return;
    }

    // Check if we already have significant data (e.g. > 1000 total messages counted)
    let totalCount = 0;
    Object.values(activityCache).forEach(dates => {
        Object.values(dates).forEach(c => totalCount += c);
    });

    // If data exists, maybe skip deep backfill, or just doing a shallow incremental?
    // User wants "Speed", implies reliability.
    // We will only backfill if totalCount is low (< 100).
    if (totalCount > 100) {
        console.log('[ActivityTracker] Data exists, skipping deep backfill.');
        isBackfilling = false;
        return;
    }

    let lastId = undefined;
    let loops = 0;
    const LIMIT_MSGS = 5000; // Backfill 5000 messages
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    try {
        while (loops < 50) { // 50 * 100 = 5000
            const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
            if (msgs.size === 0) break;

            for (const msg of msgs.values()) {
                if (msg.createdTimestamp < oneMonthAgo) {
                    lastId = null;
                    break;
                }
                if (msg.author.bot) continue;

                // Determine Date Key for THIS message
                const msgDate = new Date(msg.createdTimestamp);
                const msgJst = new Date(msgDate.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
                const y = msgJst.getFullYear();
                const m = String(msgJst.getMonth() + 1).padStart(2, '0');
                const d = String(msgJst.getDate()).padStart(2, '0');
                const dateKey = `${y}-${m}-${d}`;

                if (!activityCache[msg.author.id]) activityCache[msg.author.id] = {};
                if (!activityCache[msg.author.id][dateKey]) activityCache[msg.author.id][dateKey] = 0;
                activityCache[msg.author.id][dateKey]++;

                lastId = msg.id;
            }
            if (!lastId) break;
            loops++;
            if (loops % 10 === 0) console.log(`[ActivityTracker] Backfill progress: ${loops * 100} msgs`);
        }
        saveData();
        console.log('[ActivityTracker] Backfill complete.');
    } catch (e) {
        console.error('[ActivityTracker] Backfill error:', e);
    } finally {
        isBackfilling = false;
    }
}

function setup(client) {
    loadData();

    // Listen for new messages
    client.on('messageCreate', (message) => {
        if (message.author.bot) return;
        if (message.channelId !== MAIN_CHANNEL_ID) return;

        const dateKey = getTodayKey();
        if (!activityCache[message.author.id]) activityCache[message.author.id] = {};
        if (!activityCache[message.author.id][dateKey]) activityCache[message.author.id][dateKey] = 0;

        activityCache[message.author.id][dateKey]++;

        // Save periodically? Or on every message?
        // Saving on every message is I/O heavy.
        // Save every 5 minutes or handling process exit is better.
        // For simplicity here, we rely on the interval below.
    });

    // Auto-save and Auto-Backfill on startup
    setTimeout(() => backfill(client), 5000); // Start backfill 5s after boot

    // Save every 5 minutes
    setInterval(() => {
        saveData();
    }, 5 * 60 * 1000);
}

function getUserRanking(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const ranking = [];

    Object.entries(activityCache).forEach(([userId, dateCounts]) => {
        let count = 0;
        Object.entries(dateCounts).forEach(([dateStr, c]) => {
            const date = new Date(dateStr);
            if (date >= cutoff) {
                count += c;
            }
        });
        if (count > 0) {
            ranking.push({ userId, count });
        }
    });

    return ranking.sort((a, b) => b.count - a.count);
}

module.exports = {
    setup,
    getUserRanking
};
