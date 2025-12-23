const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { ADMIN_ROLE_ID } = require('../constants');
const https = require('https');

// Config
const CHANNEL_NAME = '🛡️memory-store';
const FILES = ['activity_data.json', 'custom_cooldowns.json', 'duel_data.json'];
const SAVE_INTERVAL = 60 * 1000; // 1 min

let storedMessageId = null;

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
	const guild = client.guilds.cache.first();
	if (!guild) return;

	const channel = guild.channels.cache.find((c) => c.name === CHANNEL_NAME);
	if (!channel) {
		console.log('[Persistence] No memory store channel found. Starting fresh.');
		return;
	}

	try {
		const messages = await channel.messages.fetch({ limit: 1 });
		const lastMsg = messages.first();
		if (!lastMsg || lastMsg.attachments.size === 0) {
			console.log('[Persistence] No data found in memory store.');
			storedMessageId = lastMsg?.id;
			return;
		}

		storedMessageId = lastMsg.id;
		console.log(`[Persistence] Found save slot: ${storedMessageId}`);

		// Download Attachments
		for (const [key, attachment] of lastMsg.attachments) {
			if (FILES.includes(attachment.name)) {
				const dest = path.join(__dirname, '..', attachment.name);
				await downloadFile(attachment.url, dest);
				console.log(`[Persistence] Restored ${attachment.name}`);
			}
		}
		console.log('[Persistence] Restoration complete.');
	} catch (e) {
		console.error('[Persistence] Restore failed:', e);
	}
}

// --- Core: Save ---
async function save(client) {
	// console.log('[Persistence] Saving data...');
	const guild = client.guilds.cache.first();
	if (!guild) return;

	let channel = guild.channels.cache.find((c) => c.name === CHANNEL_NAME);

	// Create Channel if missing
	if (!channel) {
		try {
			channel = await guild.channels.create({
				name: CHANNEL_NAME,
				type: ChannelType.GuildText,
				permissionOverwrites: [
					{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
					{ id: ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel] },
					{
						id: client.user.id,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.AttachFiles,
						],
					},
				],
				topic: 'SYSTEM MEMORY - AUTO UPDATED. DO NOT TOUCH.',
			});
		} catch (e) {
			console.error('[Persistence] Failed to create channel:', e);
			return;
		}
	}

	// Prepare Files
	const uploads = [];
	for (const file of FILES) {
		const p = path.join(__dirname, '..', file);
		if (fs.existsSync(p)) {
			uploads.push({ attachment: p, name: file });
		}
	}

	if (uploads.length === 0) return;

	try {
		// Overwrite strategy: Edit the known message, or send new if missing
		if (storedMessageId) {
			try {
				const msg = await channel.messages.fetch(storedMessageId);
				await msg.edit({
					content: `🧠 **System Memory Bank**\nLast Updated: <t:${Math.floor(Date.now() / 1000)}:R>`,
					files: uploads,
				});
				return;
			} catch (e) {
				console.warn('[Persistence] Stored message lost, sending new one.');
				storedMessageId = null;
			}
		}

		// Send New
		const msg = await channel.send({
			content: `🧠 **System Memory Bank**\nLast Updated: <t:${Math.floor(Date.now() / 1000)}:R>`,
			files: uploads,
		});
		storedMessageId = msg.id;

		// Cleanup old messages to keep channel clean?
		// For now, just keeping one is fine.
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
