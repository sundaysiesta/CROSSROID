const fs = require('fs');
const path = require('path');
const { MAIN_CHANNEL_ID } = require('../constants');
const { getDataKey, migrateData } = require('./dataAccess');

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
	const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
	const y = jst.getFullYear();
	const m = String(jst.getMonth() + 1).padStart(2, '0');
	const d = String(jst.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

async function trackMessage(message) {
	const dateKey = getTodayKey();

	// データ引き継ぎ（ID → Notion名）
	await migrateData(message.author.id, activityCache);

	// データキーを取得
	const dataKey = await getDataKey(message.author.id);

	if (!activityCache[dataKey]) activityCache[dataKey] = {};
	if (!activityCache[dataKey][dateKey]) activityCache[dataKey][dateKey] = 0;

	activityCache[dataKey][dateKey]++;
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
	const jstFormatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: 'numeric',
	});
	const parts = jstFormatter.formatToParts(now);
	const y = parts.find((p) => p.type === 'year').value;
	const m = parts.find((p) => p.type === 'month').value;
	// Format: YYYY-MM-01T00:00:00+09:00
	const startOfMonthTimestamp = new Date(`${y}-${m.padStart(2, '0')}-01T00:00:00+09:00`).getTime();

	// --- SMART SKIP LOGIC ---
	// --- SMART SKIP LOGIC ---
	if (activityCache._meta) {
		const { lastDeepScan, oldestScanDepth } = activityCache._meta;

		console.log(
			`[Backfill Debug] LastScan: ${new Date(lastDeepScan).toLocaleString()} | TargetMonth: ${new Date(
				startOfMonthTimestamp
			).toLocaleString()} | DepthReached: ${new Date(oldestScanDepth).toLocaleString()}`
		);

		if (lastDeepScan > startOfMonthTimestamp && oldestScanDepth <= startOfMonthTimestamp + 60 * 60 * 1000) {
			const lastScanDate = new Date(lastDeepScan).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
			console.log(`[ActivityTracker] ✅ Skipping Deep Scan (Already scanned this month at ${lastScanDate}).`);
			isBackfilling = false;
			return;
		} else {
			console.log('[Backfill Debug] Conditions not met. (New month? or previous scan incomplete?)');
		}
	} else {
		console.log('[Backfill Debug] No metadata found. First run?');
	}
	// ------------------------
	// ------------------------

	let lastId = undefined;
	let loops = 0;
	const LIMIT_MSGS = 100000;
	const MAX_LOOPS = LIMIT_MSGS / 100;

	// Store oldest timestamp reached
	let oldestReached = Date.now();

	try {
		while (loops < MAX_LOOPS) {
			const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
			if (msgs.size === 0) {
				console.log('[ActivityTracker] Stop Reason: No more messages returned from Discord.');
				break;
			}

			for (const msg of msgs.values()) {
				if (msg.createdTimestamp < startOfMonthTimestamp) {
					console.log(
						`[ActivityTracker] Stop Reason: Reached cutoff date. MsgDate: ${new Date(
							msg.createdTimestamp
						).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
					);
					lastId = null; // Signal stop
					break;
				}

				oldestReached = msg.createdTimestamp;

				if (!msg.author || msg.author.bot) {
					lastId = msg.id;
					continue;
				}

				const msgDate = new Date(msg.createdTimestamp);
				const msgJst = new Date(msgDate.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
				const y = msgJst.getFullYear();
				const m = String(msgJst.getMonth() + 1).padStart(2, '0');
				const d = String(msgJst.getDate()).padStart(2, '0');
				const dateKey = `${y}-${m}-${d}`;

				// データ引き継ぎ（ID → Notion名）
				await migrateData(msg.author.id, activityCache);

				// データキーを取得
				const dataKey = await getDataKey(msg.author.id);

				if (!activityCache[dataKey]) activityCache[dataKey] = {};
				if (!activityCache[dataKey][dateKey]) activityCache[dataKey][dateKey] = 0;
				activityCache[dataKey][dateKey]++;

				lastId = msg.id;
			}
			if (!lastId) break; // Inner loop signaled stop or fetch ended
			loops++;

			if (loops % 50 === 0) {
				console.log(`[ActivityTracker] Backfill progress: ${loops * 100} msgs`);
			}
		}

		if (loops >= MAX_LOOPS) {
			console.log('[ActivityTracker] Stop Reason: Hit message fetch limit.');
			// CRITICAL FIX: If we hit the limit, consider it "Good Enough" for the month.
			// Otherwise it will re-scan forever because it never reaches the 1st.
			oldestReached = startOfMonthTimestamp;
		}

		console.log(`[ActivityTracker] Backfill finish. Oldest reached: ${new Date(oldestReached).toLocaleString()}`);

		// SAVE METADATA
		activityCache._meta = {
			lastDeepScan: Date.now(),
			oldestScanDepth: oldestReached,
		};

		saveData();
		console.log('[ActivityTracker] Backfill complete.');
	} catch (e) {
		console.error('[ActivityTracker] Backfill error:', e);
	} finally {
		isBackfilling = false;
	}
}

function start(client) {
	loadData();

	// --- EVENT LISTENER ---
	client.on('messageCreate', async (message) => {
		if (message.author.bot) {
			// Track bot messages too for total count debug
			activityCache._meta = activityCache._meta || {};
			activityCache._meta.totalBotMessages = (activityCache._meta.totalBotMessages || 0) + 1;
			return;
		}
		if (message.channel.id !== MAIN_CHANNEL_ID) return;

		await trackMessage(message);
	});

	// Auto-save periodically
	setInterval(() => {
		saveData();
	}, 5 * 60 * 1000);

	// REMOVED: Automatic backfill call.
	// User requested manual control via command.
	// this.backfill(client);
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
	start,
	backfill,
	getUserRanking,
};
