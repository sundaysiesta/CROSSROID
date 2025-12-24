const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { ADMIN_ROLE_ID, DATABASE_CHANNEL_ID } = require('../constants');
const https = require('https');

// Config
const FILES = ['activity_data.json', 'custom_cooldowns.json', 'duel_data.json', 'janken_data.json', 'shop_data.json', 'mahjong_data.json'];
const SAVE_INTERVAL = 60 * 1000; // 1 min

// --- Helper: Download File ---
function downloadFile(url, destPath) {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(destPath);
		https
			.get(url, (response) => {
				response.pipe(file);
				file.on('finish', () => {
					file.close();
					resolve();
				});
			})
			.on('error', (err) => {
				fs.unlink(destPath, () => {});
				reject(err);
			});
	});
}

// --- Core: Restore ---
async function restore(client) {
	console.log('[Persistence] Attempting to restore data from Discord...');
	
	try {
		const db_channel = await client.channels.fetch(DATABASE_CHANNEL_ID);
		const messages = await db_channel.messages.fetch({ limit: 100, cache: false });
		
		// 各ファイルについて最新のメッセージを探す
		const fileMessages = new Map(); // file -> message
		
		for (const [msgId, message] of messages) {
			for (const [attachmentId, attachment] of message.attachments) {
				if (FILES.includes(attachment.name)) {
					// まだ見つかっていない、またはより新しいメッセージの場合
					if (!fileMessages.has(attachment.name) || message.createdTimestamp > fileMessages.get(attachment.name).createdTimestamp) {
						fileMessages.set(attachment.name, { message, attachment });
					}
				}
			}
		}

		// 各ファイルを復元
		for (const [fileName, { message, attachment }] of fileMessages) {
			const dest = path.join(__dirname, '..', fileName);
			try {
				await downloadFile(attachment.url, dest);
				console.log(`[Persistence] Restored ${fileName} from message ${message.id}`);
			} catch (e) {
				console.error(`[Persistence] ファイル復元失敗: ${fileName}`, e);
			}
		}

		if (fileMessages.size === 0) {
			console.log('[Persistence] No data found in database channel.');
		} else {
			console.log(`[Persistence] Restoration complete. Restored ${fileMessages.size} file(s).`);
		}
	} catch (e) {
		console.error('[Persistence] Restore failed:', e);
	}
}

// --- Core: Save ---
async function save(client) {
	// console.log('[Persistence] Saving data...');
	try {
		const db_channel = await client.channels.fetch(DATABASE_CHANNEL_ID);

		// Prepare Files（ロメコインと同じ方式：ファイルパスの文字列配列）
		const uploads = [];
		for (const file of FILES) {
			const p = path.join(__dirname, '..', file);
			if (fs.existsSync(p)) {
				uploads.push(p);
			}
		}

		if (uploads.length === 0) return;

		// ロメコインと同じ方式：新しいメッセージとして送信（編集しない）
		await db_channel.send({ files: uploads });
		console.log(`[Persistence] Saved ${uploads.length} file(s) to database channel: ${FILES.filter(f => fs.existsSync(path.join(__dirname, '..', f))).join(', ')}`);
	} catch (e) {
		console.error('[Persistence] Save failed:', e);
	}
}

let isSaving = false;
let saveQueue = false;
let lastSaveTime = 0;
const MIN_SAVE_INTERVAL = 10000; // 10 seconds throttle

async function safeSave(client) {
	if (isSaving) {
		saveQueue = true;
		return;
	}

	const now = Date.now();
	const timeSinceLast = now - lastSaveTime;

	if (timeSinceLast < MIN_SAVE_INTERVAL) {
		// Too soon, schedule it
		if (!saveQueue) {
			saveQueue = true;
			setTimeout(() => safeSave(client), MIN_SAVE_INTERVAL - timeSinceLast);
		}
		return;
	}

	isSaving = true;
	saveQueue = false;
	try {
		await save(client);
		lastSaveTime = Date.now();
	} finally {
		isSaving = false;
		// If more requests came in, trigger again
		if (saveQueue) {
			safeSave(client);
		}
	}
}

function startSync(client) {
	// Background sync as backup
	setInterval(() => safeSave(client), SAVE_INTERVAL);
}

module.exports = { restore, startSync, save: safeSave };

