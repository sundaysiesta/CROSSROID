const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { ADMIN_ROLE_ID, DATABASE_CHANNEL_ID } = require('../constants');
const https = require('https');

// Config
const FILES = ['romecoin_data.json', 'activity_data.json', 'custom_cooldowns.json', 'duel_data.json', 'janken_data.json', 'shop_data.json', 'mahjong_data.json', 'bank_data.json', 'loan_data.json', 'daily_data.json', 'club_investment_data.json', 'parimutuel_data.json'];
const SAVE_INTERVAL = 60 * 1000; // 1 min
// Discordのメッセージには添付ファイル数の上限があるため、分割送信する
const MAX_FILES_PER_MESSAGE = 10;

// 各ファイルについて、最後に読み込んだ時のタイムスタンプを保存（二重起動時の競合検出用）
// key: fileName, value: { timestamp: number, messageId: string }
const fileLoadTimestamps = new Map();

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
				// 読み込んだファイルのタイムスタンプを記録（二重起動時の競合検出用）
				fileLoadTimestamps.set(fileName, {
					timestamp: message.createdTimestamp,
					messageId: message.id
				});
				console.log(`[Persistence] Restored ${fileName} from message ${message.id} (timestamp: ${message.createdTimestamp})`);
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

		// 二重起動時の競合検出：保存前に最新メッセージをチェック
		const messages = await db_channel.messages.fetch({ limit: 100, cache: false });
		const latestFileMessages = new Map(); // file -> { timestamp, messageId }
		
		for (const [msgId, message] of messages) {
			for (const [attachmentId, attachment] of message.attachments) {
				if (FILES.includes(attachment.name)) {
					if (!latestFileMessages.has(attachment.name) || 
						message.createdTimestamp > latestFileMessages.get(attachment.name).timestamp) {
						latestFileMessages.set(attachment.name, {
							timestamp: message.createdTimestamp,
							messageId: message.id
						});
					}
				}
			}
		}

		// Prepare Files（ロメコインと同じ方式：ファイルパスの文字列配列）
		const uploads = [];
		const skippedFiles = [];
		
		for (const file of FILES) {
			const p = path.join(__dirname, '..', file);
			if (fs.existsSync(p)) {
				// 二重起動時の競合チェック
				const loadedInfo = fileLoadTimestamps.get(file);
				const latestInfo = latestFileMessages.get(file);
				
				if (loadedInfo && latestInfo) {
					// 最新メッセージが読み込んだ時点より新しい場合、競合と判断
					if (latestInfo.timestamp > loadedInfo.timestamp) {
						console.warn(`[Persistence] ⚠️ 競合検出: ${file} は他のインスタンスによって更新されています（読み込み時: ${loadedInfo.timestamp}, 最新: ${latestInfo.timestamp}）。保存をスキップします。`);
						// タイムスタンプを最新のものに更新して、次回の保存時に競合が解消されるようにする
						fileLoadTimestamps.set(file, {
							timestamp: latestInfo.timestamp,
							messageId: latestInfo.messageId
						});
						skippedFiles.push(file);
						continue;
					}
				}
				
				uploads.push(p);
			}
		}

		if (uploads.length === 0) {
			if (skippedFiles.length > 0) {
				console.log(`[Persistence] すべてのファイルが競合によりスキップされました: ${skippedFiles.join(', ')}`);
			} else {
				console.log('[Persistence] No files to save');
			}
			return; // 保存するファイルがない場合は正常終了
		}

		if (skippedFiles.length > 0) {
			console.log(`[Persistence] 競合によりスキップされたファイル: ${skippedFiles.join(', ')}`);
		}

		// Discordのメッセージには添付ファイル数の上限があるため、分割送信
		for (let i = 0; i < uploads.length; i += MAX_FILES_PER_MESSAGE) {
			const batch = uploads.slice(i, i + MAX_FILES_PER_MESSAGE);
			const message = await db_channel.send({ files: batch });
			
			// 送信したファイルのタイムスタンプを記録（次回の競合検出用）
			for (const filePath of batch) {
				const fileName = path.basename(filePath);
				fileLoadTimestamps.set(fileName, {
					timestamp: message.createdTimestamp,
					messageId: message.id
				});
			}
			
			console.log(`[Persistence] Saved batch ${Math.floor(i / MAX_FILES_PER_MESSAGE) + 1}: ${batch.map(f => path.basename(f)).join(', ')}`);
		}
		console.log(`[Persistence] Saved ${uploads.length} file(s) to database channel (${Math.ceil(uploads.length / MAX_FILES_PER_MESSAGE)} message(s))`);
	} catch (e) {
		console.error('[Persistence] Save failed:', e);
		// エラーを再スローして、呼び出し側でリトライできるようにする
		throw e;
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

// 管理者コマンド用：特定のファイルを復元
async function restoreFile(client, fileName, messageId = null) {
	console.log(`[Persistence] Attempting to restore ${fileName} from Discord...`);
	
	try {
		const db_channel = await client.channels.fetch(DATABASE_CHANNEL_ID);
		
		// メッセージIDが指定されている場合、そのメッセージから直接復元
		if (messageId) {
			try {
				const message = await db_channel.messages.fetch(messageId);
				let targetAttachment = null;
				
				for (const [attachmentId, attachment] of message.attachments) {
					if (attachment.name === fileName) {
						targetAttachment = attachment;
						break;
					}
				}
				
				if (!targetAttachment) {
					return { 
						success: false, 
						message: `メッセージID ${messageId} にファイル ${fileName} が見つかりませんでした。` 
					};
				}
				
				const dest = path.join(__dirname, '..', fileName);
				await downloadFile(targetAttachment.url, dest);
				// 読み込んだファイルのタイムスタンプを記録
				fileLoadTimestamps.set(fileName, {
					timestamp: message.createdTimestamp,
					messageId: messageId
				});
				console.log(`[Persistence] Restored ${fileName} from message ${messageId}`);
				return { 
					success: true, 
					message: `ファイル ${fileName} を復元しました（メッセージID: ${messageId}）`,
					messageId: messageId,
					timestamp: message.createdTimestamp
				};
			} catch (e) {
				console.error(`[Persistence] メッセージ取得エラー: ${messageId}`, e);
				return { success: false, message: `メッセージID ${messageId} の取得に失敗しました: ${e.message}` };
			}
		}
		
		// メッセージIDが指定されていない場合、最新のファイルを探す
		const messages = await db_channel.messages.fetch({ limit: 100, cache: false });
		
		// 指定されたファイル名の最新のメッセージを探す
		let latestMessage = null;
		let latestAttachment = null;
		let latestTimestamp = 0;
		
		for (const [msgId, message] of messages) {
			for (const [attachmentId, attachment] of message.attachments) {
				if (attachment.name === fileName) {
					if (message.createdTimestamp > latestTimestamp) {
						latestTimestamp = message.createdTimestamp;
						latestMessage = message;
						latestAttachment = attachment;
					}
				}
			}
		}

		if (!latestMessage || !latestAttachment) {
			console.log(`[Persistence] File ${fileName} not found in database channel.`);
			return { success: false, message: `ファイル ${fileName} が見つかりませんでした。` };
		}

		// ファイルを復元
		const dest = path.join(__dirname, '..', fileName);
		try {
			await downloadFile(latestAttachment.url, dest);
			// 読み込んだファイルのタイムスタンプを記録
			fileLoadTimestamps.set(fileName, {
				timestamp: latestMessage.createdTimestamp,
				messageId: latestMessage.id
			});
			console.log(`[Persistence] Restored ${fileName} from message ${latestMessage.id}`);
			return { 
				success: true, 
				message: `ファイル ${fileName} を復元しました（メッセージID: ${latestMessage.id}）`,
				messageId: latestMessage.id,
				timestamp: latestMessage.createdTimestamp
			};
		} catch (e) {
			console.error(`[Persistence] ファイル復元失敗: ${fileName}`, e);
			return { success: false, message: `ファイル ${fileName} の復元に失敗しました: ${e.message}` };
		}
	} catch (e) {
		console.error('[Persistence] Restore file failed:', e);
		return { success: false, message: `復元処理に失敗しました: ${e.message}` };
	}
}

module.exports = { restore, startSync, save: safeSave, restoreFile };

