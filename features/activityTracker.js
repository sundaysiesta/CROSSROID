const fs = require('fs');
const path = require('path');
const { MAIN_CHANNEL_ID } = require('../constants');

const DATA_FILE = path.join(__dirname, '../activity_data.json');

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
    console.log('[ActivityTracker] Checking backfill necessity...');

    const channel = client.channels.cache.get(MAIN_CHANNEL_ID);
    if (!channel) {
        console.error('[ActivityTracker] Main channel not found.');
        isBackfilling = false;
        return;
    }

    const now = new Date();
    // Calculate Start of Current Month in JST
    const jstFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' });
    const parts = jstFormatter.formatToParts(now);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    // Format: YYYY-MM-01T00:00:00+09:00
    const startOfMonthTimestamp = new Date(`${y}-${m.padStart(2, '0')}-01T00:00:00+09:00`).getTime();


    // --- SMART SKIP LOGIC ---
    if (activityCache._meta) {
        const { lastDeepScan, oldestScanDepth } = activityCache._meta;
        const scanAge = Date.now() - (lastDeepScan || 0);

        // If scanned within last 2 hours AND reached Start of Month (with 1 hour margin)
        if (scanAge < 2 * 60 * 60 * 1000 && oldestScanDepth <= startOfMonthTimestamp + (60 * 60 * 1000)) {
            console.log(`[ActivityTracker] ✅ Skipping Deep Scan (Data is fresh, scanned ${Math.floor(scanAge / 60000)} mins ago).`);
            require('../utils').logSystem(`⏩ **Backfill Skipped**\nData is fresh (Scanned: ${new Date(lastDeepScan).toLocaleTimeString('ja-JP')}).\nStarting normal tracking.`, 'ActivityTracker');
            isBackfilling = false;
            return;
        }
    }
    // ------------------------

    let lastId = undefined;
    let loops = 0;
    const LIMIT_MSGS = 100000;
    const MAX_LOOPS = LIMIT_MSGS / 100;

    // Store oldest timestamp reached
    let oldestReached = Date.now();

    try {
        const dateStr = new Date(startOfMonthTimestamp).toLocaleDateString('ja-JP');
        require('../utils').logSystem(`🔄 **Activity Backfill Started**\nTarget: Until ${dateStr} (Start of Month)\n(Timestamp: ${startOfMonthTimestamp})`, 'ActivityTracker');

        while (loops < MAX_LOOPS) {
            const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
            if (msgs.size === 0) {
                console.log('[ActivityTracker] Stop Reason: No more messages returned from Discord.');
                break;
            }

            for (const msg of msgs.values()) {
                if (msg.createdTimestamp < startOfMonthTimestamp) {
                    console.log(`[ActivityTracker] Stop Reason: Reached cutoff date. MsgDate: ${new Date(msg.createdTimestamp).toLocaleString('ja-JP')}`);
                    lastId = null; // Signal stop
                    break;
                }

                oldestReached = msg.createdTimestamp;

                if (!msg.author || msg.author.bot) {
                    lastId = msg.id;
                    continue;
                }

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
            if (!lastId) break; // Inner loop signaled stop or fetch ended
            loops++;

            if (loops % 50 === 0) {
                const progress = Math.round((loops / MAX_LOOPS) * 100);
                console.log(`[ActivityTracker] Backfill progress: ${loops * 100} msgs`);
                if (loops % 100 === 0) {
                    require('../utils').logSystem(`📊 **Backfill Progress**\nScanned: ${loops * 100} / ${LIMIT_MSGS} messages`, 'ActivityTracker');
                }
            }
        }

        // SAVE METADATA
        activityCache._meta = {
            lastDeepScan: Date.now(),
            oldestScanDepth: oldestReached
        };

        saveData();
        console.log('[ActivityTracker] Backfill complete.');
        require('../utils').logSystem(`✅ **Activity Backfill Complete**\nTotal Scanned: ${loops * 100} messages.\nDepth: ${new Date(oldestReached).toLocaleDateString('ja-JP')}\n(Target was: ${dateStr})`, 'ActivityTracker');
    } catch (e) {
        console.error('[ActivityTracker] Backfill error:', e);
        require('../utils').logError(e, 'ActivityTracker Backfill');
    } finally {
        isBackfilling = false;
    }
}

function setup(client) {
    loadData();

    client.on('messageCreate', (message) => {
        if (message.author.bot) return;
        if (message.channelId !== MAIN_CHANNEL_ID) return;

        const dateKey = getTodayKey();
        if (!activityCache[message.author.id]) activityCache[message.author.id] = {};
        if (!activityCache[message.author.id][dateKey]) activityCache[message.author.id][dateKey] = 0;

        activityCache[message.author.id][dateKey]++;
    });

    setTimeout(() => backfill(client), 5000);

    setInterval(() => {
        saveData();
    }, 5 * 60 * 1000);
}

function getUserRanking(mode = 30) {
    let cutoff = new Date();

    if (mode === 'month') {
        cutoff.setDate(1);
        cutoff.setHours(0, 0, 0, 0);
    } else {
        const days = typeof mode === 'number' ? mode : 30;
        cutoff.setDate(cutoff.getDate() - days);
    }

    const ranking = [];

    Object.entries(activityCache).forEach(([userId, dateCounts]) => {
        if (userId === '_meta') return; // Skip metadata

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
