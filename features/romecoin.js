const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getData, updateData, migrateData } = require('./dataAccess');
const { ROMECOIN_LOG_CHANNEL_ID } = require('../constants');
const persistence = require('./persistence');

const ROMECOIN_DATA_FILE = path.join(__dirname, '..', 'romecoin_data.json');
const ROMECOIN_DATA_BACKUP_FILE = path.join(__dirname, '..', 'romecoin_data.json.backup');
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';

// 数値の最大値（JavaScriptの安全な整数範囲内）
const MAX_SAFE_VALUE = Number.MAX_SAFE_INTEGER; // 2^53 - 1 = 9007199254740991

// グローバル変数としてromecoin_dataを初期化
let romecoin_data = null;

// Discordクライアントの参照（Discordへの送信用）
let discordClient = null;

// 同時実行制御用のロック（ユーザーIDごと）
const updateLocks = new Map();

// データ保存用のロック（同時書き込みを防ぐ）
let saveLock = false;
let saveQueue = [];

// ランキングコマンドのクールダウン
let romecoin_ranking_cooldowns = new Map();

// ランキングデータのキャッシュ（ページネーション用）
// key: cacheKey, value: { data: Array, timestamp: number }
const rankingCache = new Map();

// キャッシュのクリーンアップ（5分ごと、10分以上古いデータを削除）
setInterval(() => {
	const now = Date.now();
	const maxAge = 10 * 60 * 1000; // 10分
	for (const [key, value] of rankingCache) {
		if (now - value.timestamp > maxAge) {
			rankingCache.delete(key);
		}
	}
}, 5 * 60 * 1000); // 5分ごと

// メッセージ送信報酬のクールダウン
let messageRewardCooldowns = new Map();

// 会話参加者数の追跡（過去5分以内のメッセージ送信者を記録）
// key: timestamp (分単位), value: Set of userIds
let conversationParticipants = new Map();

// VC参加者の追跡（定期的にロメコインを付与）
// key: userId, value: { channelId, lastReward, intervalId }
let vcParticipants = new Map();

// 数値の検証関数
function validateAmount(amount) {
	if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
		return { valid: false, error: '数値が無効です' };
	}
	if (amount < 0) {
		return { valid: false, error: '負の値は許可されていません' };
	}
	if (amount > MAX_SAFE_VALUE) {
		return { valid: false, error: `数値が大きすぎます（最大値: ${MAX_SAFE_VALUE.toLocaleString()}）` };
	}
	return { valid: true };
}

// データ読み込み
function loadRomecoinData() {
	console.log(`[Romecoin] loadRomecoinData: データ読み込み開始`);
	
	// ファイルから常に最新のデータを読み込む
	let fileData = null;
	
	// まず通常のファイルを読み込む
	if (fs.existsSync(ROMECOIN_DATA_FILE)) {
		try {
			const content = fs.readFileSync(ROMECOIN_DATA_FILE, 'utf8');
			console.log(`[Romecoin] メインファイル読み込み: ${ROMECOIN_DATA_FILE} (${content.length} bytes)`);
			if (content.trim() !== '') {
				fileData = JSON.parse(content);
				console.log(`[Romecoin] メインファイル解析完了: エントリ数=${Object.keys(fileData).length}`);
			} else {
				console.warn(`[Romecoin] メインファイルが空です: ${ROMECOIN_DATA_FILE}`);
			}
		} catch (e) {
			console.error('[Romecoin] データ読み込みエラー:', e);
			console.error('[Romecoin] エラースタック:', e.stack);
		}
	} else {
		console.warn(`[Romecoin] メインファイルが存在しません: ${ROMECOIN_DATA_FILE}`);
	}
	
	// ファイルが空または存在しない場合、バックアップから復元を試みる
	if (!fileData || Object.keys(fileData).length === 0) {
		console.warn('[Romecoin] メインファイルが空または存在しません。バックアップから復元を試みます...');
		if (fs.existsSync(ROMECOIN_DATA_BACKUP_FILE)) {
			try {
				const backupContent = fs.readFileSync(ROMECOIN_DATA_BACKUP_FILE, 'utf8');
				if (backupContent.trim() !== '') {
					fileData = JSON.parse(backupContent);
					console.log(`[Romecoin] バックアップからデータを復元しました: エントリ数=${Object.keys(fileData).length}`);
					// 復元したデータをメインファイルに保存
					romecoin_data = fileData;
					saveRomecoinData().catch(err => {
						console.error('[Romecoin] 復元データ保存エラー:', err);
					});
					console.log('[Romecoin] 復元したデータをメインファイルに保存しました');
				}
			} catch (e) {
				console.error('[Romecoin] バックアップからの復元エラー:', e);
				console.error('[Romecoin] エラースタック:', e.stack);
			}
		} else {
			console.warn('[Romecoin] バックアップファイルも見つかりませんでした');
		}
	}
	
	// データを設定
	if (romecoin_data === null) {
		romecoin_data = fileData || {};
		console.log(`[Romecoin] グローバル変数を初期化: エントリ数=${Object.keys(romecoin_data).length}`);
	} else if (fileData) {
		// ファイルのデータで上書き（ファイルを優先）
		romecoin_data = fileData;
		console.log(`[Romecoin] グローバル変数を更新: エントリ数=${Object.keys(romecoin_data).length}`);
	}
	
	console.log(`[Romecoin] loadRomecoinData: データ読み込み完了: エントリ数=${Object.keys(romecoin_data).length}`);
	return romecoin_data;
}

// データ保存（アトミック書き込みとロック機能付き）
async function saveRomecoinData() {
	if (romecoin_data === null) {
		console.warn('[Romecoin] saveRomecoinData: romecoin_dataがnullです。保存をスキップします。');
		return;
	}

	// ロックがかかっている場合はキューに追加
	if (saveLock) {
		return new Promise((resolve) => {
			saveQueue.push(resolve);
		});
	}

	// ロックを取得
	saveLock = true;

	try {
		const dataCount = Object.keys(romecoin_data).length;
		console.log(`[Romecoin] saveRomecoinData: エントリ数=${dataCount}`);
		
		// データの整合性を確認
		if (dataCount === 0) {
			console.warn('[Romecoin] データが空です。保存をスキップします。');
			return;
		}

		// バックアップを作成（既存のファイルがある場合、書き込み前に作成）
		if (fs.existsSync(ROMECOIN_DATA_FILE)) {
			try {
				fs.copyFileSync(ROMECOIN_DATA_FILE, ROMECOIN_DATA_BACKUP_FILE);
				console.log(`[Romecoin] バックアップ作成完了: ${ROMECOIN_DATA_BACKUP_FILE}`);
			} catch (e) {
				console.warn('[Romecoin] バックアップ作成エラー（無視）:', e);
			}
		}

		// JSONデータを生成
		const jsonData = JSON.stringify(romecoin_data, null, 2);
		const dataSize = Buffer.byteLength(jsonData, 'utf8');
		console.log(`[Romecoin] データサイズ: ${dataSize} bytes`);

		// アトミック書き込み：一時ファイルに書き込んでからリネーム
		const tempFile = `${ROMECOIN_DATA_FILE}.tmp`;
		
		try {
			// 一時ファイルに書き込み
			fs.writeFileSync(tempFile, jsonData, { encoding: 'utf8', flag: 'w' });
			
			// 一時ファイルの整合性を確認（読み込んで検証）
			const verifyData = fs.readFileSync(tempFile, 'utf8');
			const verifyParsed = JSON.parse(verifyData);
			if (Object.keys(verifyParsed).length !== dataCount) {
				throw new Error('一時ファイルの検証に失敗しました（エントリ数が一致しません）');
			}
			
			// リネーム（アトミック操作）
			fs.renameSync(tempFile, ROMECOIN_DATA_FILE);
			
			console.log(`[Romecoin] データ保存完了: ${ROMECOIN_DATA_FILE} (${dataSize} bytes)`);
			
			// Discordに即座に送信（再起動を前提とした動作）
			if (discordClient && discordClient.isReady()) {
				try {
					await persistence.save(discordClient);
					console.log('[Romecoin] Discordへの送信完了');
				} catch (discordError) {
					console.error('[Romecoin] Discordへの送信エラー（無視）:', discordError.message);
					// Discord送信エラーは無視（定期送信でリトライされる）
				}
			}
		} catch (writeError) {
			// 書き込みエラー時は一時ファイルを削除
			try {
				if (fs.existsSync(tempFile)) {
					fs.unlinkSync(tempFile);
				}
			} catch (unlinkError) {
				console.error('[Romecoin] 一時ファイル削除エラー:', unlinkError);
			}
			
			// バックアップから復元を試みる
			if (fs.existsSync(ROMECOIN_DATA_BACKUP_FILE)) {
				try {
					fs.copyFileSync(ROMECOIN_DATA_BACKUP_FILE, ROMECOIN_DATA_FILE);
					console.warn('[Romecoin] 書き込みエラーによりバックアップから復元しました');
				} catch (restoreError) {
					console.error('[Romecoin] バックアップからの復元エラー:', restoreError);
				}
			}
			
			throw writeError;
		}
	} catch (e) {
		console.error('[Romecoin] データ保存エラー:', e);
		console.error('[Romecoin] エラースタック:', e.stack);
	} finally {
		// ロックを解放
		saveLock = false;
		
		// キューに待機している処理があれば実行
		if (saveQueue.length > 0) {
			const nextResolve = saveQueue.shift();
			nextResolve();
			// 次の保存を実行（再帰的だが、ロックにより同時実行は防がれる）
			setImmediate(() => saveRomecoinData());
		}
	}
}

// 定期的にデータを保存（1分ごと）
setInterval(() => {
	saveRomecoinData().catch(err => {
		console.error('[Romecoin] 定期保存エラー:', err);
	});
}, 60 * 1000);

// 追加の安全策：定期的にバックアップを作成（5分ごと、タイムスタンプ付き）
const ROMECOIN_DATA_BACKUP_DIR = path.join(__dirname, '..', 'romecoin_backups');
if (!fs.existsSync(ROMECOIN_DATA_BACKUP_DIR)) {
	fs.mkdirSync(ROMECOIN_DATA_BACKUP_DIR, { recursive: true });
}

setInterval(() => {
	if (romecoin_data === null) return;
	
	try {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backupFile = path.join(ROMECOIN_DATA_BACKUP_DIR, `romecoin_data_${timestamp}.json`);
		const jsonData = JSON.stringify(romecoin_data, null, 2);
		fs.writeFileSync(backupFile, jsonData);
		
		// 古いバックアップを削除（最新10個を保持）
		const backups = fs.readdirSync(ROMECOIN_DATA_BACKUP_DIR)
			.filter(f => f.startsWith('romecoin_data_') && f.endsWith('.json'))
			.map(f => ({
				name: f,
				path: path.join(ROMECOIN_DATA_BACKUP_DIR, f),
				time: fs.statSync(path.join(ROMECOIN_DATA_BACKUP_DIR, f)).mtime.getTime()
			}))
			.sort((a, b) => b.time - a.time);
		
		// 10個を超える場合は古いものを削除
		if (backups.length > 10) {
			for (let i = 10; i < backups.length; i++) {
				try {
					fs.unlinkSync(backups[i].path);
					console.log(`[Romecoin] 古いバックアップを削除: ${backups[i].name}`);
				} catch (e) {
					console.error(`[Romecoin] バックアップ削除エラー: ${backups[i].name}`, e);
				}
			}
		}
		
		console.log(`[Romecoin] タイムスタンプ付きバックアップ作成: ${backupFile}`);
	} catch (e) {
		console.error('[Romecoin] タイムスタンプ付きバックアップ作成エラー:', e);
	}
}, 5 * 60 * 1000); // 5分ごと

// ロメコインデータを取得
function getRomecoinData() {
	return loadRomecoinData();
}

// ロメコイン残高を取得
async function getRomecoin(userId) {
	// 最新のデータを読み込む（グローバル変数から直接読み込む）
	// 注意: loadRomecoinData()は毎回ファイルから読み込むので、メモリ上の変更が失われる可能性がある
	// そのため、romecoin_dataがnullでない場合はそれを使用する
	let data;
	if (romecoin_data !== null) {
		data = romecoin_data;
		console.log(`[Romecoin] getRomecoin: グローバル変数から読み込み: userId=${userId}`);
	} else {
		data = loadRomecoinData();
		console.log(`[Romecoin] getRomecoin: ファイルから読み込み: userId=${userId}`);
	}
	await migrateData(userId, data);
	const balance = await getData(userId, data, 0);
	// 負の値や無効な値を0に正規化
	const normalizedBalance = Math.max(0, Math.min(MAX_SAFE_VALUE, Number(balance) || 0));
	console.log(`[Romecoin] getRomecoin: userId=${userId}, balance=${balance}, normalized=${normalizedBalance}`);
	return normalizedBalance;
}

// 所持金と預金の合計を取得するヘルパー関数
async function getTotalBalance(userId) {
	const romecoinBalance = await getRomecoin(userId);
	
	const bank = require('./bank');
	const bankData = bank.loadBankData();
	const { getData: getBankData } = require('./dataAccess');
	const INTEREST_RATE_PER_HOUR = 0.00000228;
	const INTEREST_INTERVAL_MS = 60 * 60 * 1000;
	const now = Date.now();
	
	const userBankData = await getBankData(userId, bankData, {
		deposit: 0,
		lastInterestTime: Date.now(),
	});
	const hoursPassed = (now - userBankData.lastInterestTime) / INTEREST_INTERVAL_MS;
	let deposit = userBankData.deposit || 0;
	if (hoursPassed > 0 && deposit > 0) {
		// 利子計算の精度を確保
		const interestRate = Math.pow(1 + INTEREST_RATE_PER_HOUR, hoursPassed) - 1;
		const interest = Math.round(deposit * interestRate);
		if (interest > 0 && deposit + interest <= MAX_SAFE_VALUE) {
			deposit += interest;
		} else if (deposit + interest > MAX_SAFE_VALUE) {
			deposit = MAX_SAFE_VALUE;
		}
	}
	
	const total = romecoinBalance + deposit;
	// 合計値も最大値を超えないようにする
	return Math.min(MAX_SAFE_VALUE, total);
}

// ロメコイン変更をログに記録
async function logRomecoinChange(client, userId, previousBalance, newBalance, reason, metadata = {}) {
	try {
		console.log(`[Romecoin] logRomecoinChange呼び出し: userId=${userId}, previous=${previousBalance}, new=${newBalance}, reason=${reason}`);
		
		if (!client) {
			console.warn('[Romecoin] クライアントがnullです。ログを送信できません。');
			return;
		}
		if (!client.isReady()) {
			console.warn('[Romecoin] クライアントが準備完了していません。ログを送信できません。');
			return;
		}
		if (!ROMECOIN_LOG_CHANNEL_ID) {
			console.warn('[Romecoin] ROMECOIN_LOG_CHANNEL_IDが設定されていません');
			return;
		}
		
		console.log(`[Romecoin] チャンネル取得を試みます: ${ROMECOIN_LOG_CHANNEL_ID}`);
		const romecoin_log_channel = await client.channels.fetch(ROMECOIN_LOG_CHANNEL_ID).catch((err) => {
			console.error('[Romecoin] ログチャンネル取得エラー:', err);
			console.error('[Romecoin] エラー詳細:', JSON.stringify(err, null, 2));
			return null;
		});
		
		if (!romecoin_log_channel) {
			console.warn(`[Romecoin] ログチャンネルが見つかりません (ID: ${ROMECOIN_LOG_CHANNEL_ID})`);
			return;
		}
		
		console.log(`[Romecoin] チャンネル取得成功: ${romecoin_log_channel.name} (${romecoin_log_channel.id})`);
		
		// 送信権限を確認
		const botMember = romecoin_log_channel.guild?.members.cache.get(client.user.id);
		if (botMember) {
			const permissions = romecoin_log_channel.permissionsFor(botMember);
			if (!permissions || !permissions.has('SendMessages') || !permissions.has('EmbedLinks')) {
				console.error(`[Romecoin] チャンネルへの送信権限がありません。SendMessages: ${permissions?.has('SendMessages')}, EmbedLinks: ${permissions?.has('EmbedLinks')}`);
				return;
			}
		}

		const diff = newBalance - previousBalance;
		const diffText = diff >= 0 ? `+${diff.toLocaleString()}` : `${diff.toLocaleString()}`;
		
		const embed = new EmbedBuilder()
			.setTitle('💰 ロメコイン変更ログ')
			.addFields(
				{ name: 'ユーザーID', value: userId, inline: true },
				{ name: '変更前', value: `${ROMECOIN_EMOJI}${previousBalance.toLocaleString()}`, inline: true },
				{ name: '変更後', value: `${ROMECOIN_EMOJI}${newBalance.toLocaleString()}`, inline: true },
				{ name: '変動', value: `${diffText}`, inline: true },
				{ name: '理由', value: reason || 'ロメコイン変更', inline: false }
			)
			.setColor(diff >= 0 ? 0x00ff00 : 0xff0000)
			.setTimestamp();

		if (metadata.commandName) {
			embed.addFields({ name: 'コマンド', value: metadata.commandName, inline: true });
		}
		if (metadata.targetUserId) {
			embed.addFields({ name: '対象ユーザー', value: metadata.targetUserId, inline: true });
		}

		console.log(`[Romecoin] ログ送信を試みます...`);
		await romecoin_log_channel.send({ embeds: [embed] }).then(() => {
			console.log(`[Romecoin] ログ送信成功: userId=${userId}`);
		}).catch((err) => {
			console.error('[Romecoin] ログ送信エラー:', err);
			console.error('[Romecoin] エラー詳細:', JSON.stringify(err, null, 2));
		});
	} catch (error) {
		console.error('[Romecoin] ログ送信エラー:', error);
		console.error('[Romecoin] エラースタック:', error.stack);
	}
}

async function updateRomecoin(userId, updateFn, options = {}) {
	console.log(`[Romecoin] updateRomecoin呼び出し: userId=${userId}, log=${options.log}, client=${!!options.client}, reason=${options.reason}`);
	
	// 同時実行制御：同じユーザーIDの更新を順次処理
	if (!updateLocks.has(userId)) {
		updateLocks.set(userId, Promise.resolve());
	}
	
	const lockPromise = updateLocks.get(userId).then(async () => {
		try {
			console.log(`[Romecoin] updateRomecoin処理開始: userId=${userId}`);
			
			// romecoin_dataを初期化
			const data = loadRomecoinData();
			console.log(`[Romecoin] データ読み込み完了: エントリ数=${Object.keys(data).length}`);
			
			await migrateData(userId, data);
			console.log(`[Romecoin] データ移行完了: userId=${userId}`);
			
			// 変更前の残高を取得（正規化済み）
			const previousBalance = await getRomecoin(userId);
			console.log(`[Romecoin] 変更前の残高: ${previousBalance} (userId=${userId})`);
			
			// 更新関数を実行して、目標残高を計算
			const targetBalance = updateFn(previousBalance);
			console.log(`[Romecoin] 目標残高: ${targetBalance} (userId=${userId})`);
			
			// 目標残高を最大値以内に制限（負の値は0に制限）
			const safeTargetBalance = Math.min(MAX_SAFE_VALUE, Math.max(0, Math.round(targetBalance)));
			console.log(`[Romecoin] 安全な目標残高: ${safeTargetBalance} (userId=${userId})`);
			
			// 預金から自動的に引き出す機能（useDeposit オプションが true の場合）
			if (options.useDeposit) {
				// useDepositが有効な場合、預金から引き出せる可能性があるため、
				// 目標残高が負でも一時的に許可し、預金から引き出した後に最終的な残高を検証する
				const bank = require('./bank');
				const bankData = bank.loadBankData();
				const { getData: getBankData, updateData: updateBankData } = require('./dataAccess');
				const INTEREST_RATE_PER_HOUR = 0.00000228;
				const INTEREST_INTERVAL_MS = 60 * 60 * 1000;
				
				// 預金データを取得（利子も計算）
				const userBankData = await getBankData(userId, bankData, {
					deposit: 0,
					lastInterestTime: Date.now(),
				});
				
				const now = Date.now();
				const hoursPassed = (now - userBankData.lastInterestTime) / INTEREST_INTERVAL_MS;
				let currentDeposit = userBankData.deposit || 0;
				if (hoursPassed > 0 && currentDeposit > 0) {
					// 利子計算の精度を確保
					const interestRate = Math.pow(1 + INTEREST_RATE_PER_HOUR, hoursPassed) - 1;
					const interest = Math.round(currentDeposit * interestRate);
					if (interest > 0 && currentDeposit + interest <= MAX_SAFE_VALUE) {
						currentDeposit += interest;
						userBankData.deposit = currentDeposit;
						userBankData.lastInterestTime = now;
					} else if (currentDeposit + interest > MAX_SAFE_VALUE) {
						currentDeposit = MAX_SAFE_VALUE;
						userBankData.deposit = currentDeposit;
						userBankData.lastInterestTime = now;
					}
				}
				
				const requiredDeduction = previousBalance - safeTargetBalance;
				
				// 減額が必要で、所持金が足りない場合、預金から引き出す
				if (requiredDeduction > 0 && previousBalance < requiredDeduction) {
					const shortage = requiredDeduction - previousBalance;
					const availableDeposit = Math.min(MAX_SAFE_VALUE, currentDeposit);
					
					if (availableDeposit >= shortage) {
						// 預金から引き出す
						const previousDeposit = currentDeposit;
						userBankData.deposit = Math.max(0, currentDeposit - shortage);
						userBankData.lastInterestTime = now;
						await updateBankData(userId, bankData, () => userBankData);
						bank.saveBankData(bankData);
						
						// 預金から引き出した分を所持金に追加してから、updateFnを適用
						const updatedKey = await updateData(userId, data, () => safeTargetBalance);
						romecoin_data = data;
						
						if (options.log && options.client) {
							await logRomecoinChange(
								options.client,
								userId,
								previousDeposit,
								userBankData.deposit,
								`預金からの自動引き出し: ${options.reason || 'ロメコイン変更'}`,
								{
									...options.metadata,
									source: 'bank_deposit',
								}
							);
						}
					} else {
						// 預金も足りない場合
						const totalAvailable = Math.min(MAX_SAFE_VALUE, previousBalance + availableDeposit);
						if (totalAvailable < requiredDeduction) {
							// 合計が足りない場合、0になるように調整
							const finalBalance = Math.max(0, totalAvailable - requiredDeduction);
							const updatedKey = await updateData(userId, data, () => finalBalance);
							romecoin_data = data;
							
							// 預金を0にする
							userBankData.deposit = 0;
							userBankData.lastInterestTime = now;
							await updateBankData(userId, bankData, () => userBankData);
							bank.saveBankData(bankData);
							
							if (options.log && options.client) {
								await logRomecoinChange(
									options.client,
									userId,
									currentDeposit,
									0,
									`預金からの自動引き出し（全額）: ${options.reason || 'ロメコイン変更'}`,
									{
										...options.metadata,
										source: 'bank_deposit',
									}
								);
							}
						} else {
							// 預金を全額引き出す
							userBankData.deposit = 0;
							userBankData.lastInterestTime = now;
							await updateBankData(userId, bankData, () => userBankData);
							bank.saveBankData(bankData);
							
							// 預金から引き出した分を所持金に追加してから、updateFnを適用
							const updatedKey = await updateData(userId, data, () => safeTargetBalance);
							romecoin_data = data;
							
							if (options.log && options.client) {
								await logRomecoinChange(
									options.client,
									userId,
									currentDeposit,
									0,
									`預金からの自動引き出し（全額）: ${options.reason || 'ロメコイン変更'}`,
									{
										...options.metadata,
										source: 'bank_deposit',
									}
								);
							}
						}
					}
				} else {
					// 減額が不要、または所持金が足りる場合は通常通り更新
					const updatedKey = await updateData(userId, data, () => safeTargetBalance);
					romecoin_data = data;
				}
			} else {
				// 預金から自動引き出しを使用しない場合は通常通り更新
				// 目標残高の検証（useDepositが無効な場合のみ）
				const targetValidation = validateAmount(targetBalance);
				if (!targetValidation.valid) {
					throw new Error(`目標残高が無効です: ${targetValidation.error}`);
				}
				
				console.log(`[Romecoin] 通常更新を実行: userId=${userId}, safeTargetBalance=${safeTargetBalance}`);
				const updatedKey = await updateData(userId, data, () => safeTargetBalance);
				console.log(`[Romecoin] データ更新完了: userId=${userId}, key=${updatedKey}, value=${data[updatedKey]}`);
				
				// グローバル変数を更新（dataオブジェクトへの参照を維持）
				romecoin_data = data;
				console.log(`[Romecoin] グローバル変数を更新: userId=${userId}, romecoin_data[${updatedKey}]=${romecoin_data[updatedKey]}`);
			}
			
			// データを保存
			console.log(`[Romecoin] データ保存を実行: userId=${userId}`);
			await saveRomecoinData();
			console.log(`[Romecoin] データ保存完了: userId=${userId}`);
			
			// 変更後の残高を取得（正規化済み）
			// 注意: getRomecoinはloadRomecoinData()を呼ぶので、保存直後でも最新のデータが読み込まれる
			const newBalance = await getRomecoin(userId);
			console.log(`[Romecoin] 変更後の残高: ${newBalance} (userId=${userId}), previousBalance=${previousBalance}`);
			
			// ログ送信（オプションで指定された場合）
			console.log(`[Romecoin] ログ送信チェック: log=${options.log}, client=${!!options.client}, balanceChanged=${previousBalance !== newBalance}`);
			if (options.log && options.client) {
				// 残高が変わった場合のみログ送信（ただし、ログ送信自体は常に試みる）
				if (previousBalance !== newBalance) {
					console.log(`[Romecoin] ログ送信を実行: userId=${userId}, previous=${previousBalance}, new=${newBalance}`);
					await logRomecoinChange(
						options.client,
						userId,
						previousBalance,
						newBalance,
						options.reason || 'ロメコイン変更',
						options.metadata || {}
					);
				} else {
					console.warn(`[Romecoin] 残高が変更されていません。ログを送信しません: userId=${userId}, balance=${previousBalance}`);
				}
			} else {
				console.warn(`[Romecoin] ログ送信条件を満たしていません: log=${options.log}, client=${!!options.client}`);
			}
			
			console.log(`[Romecoin] updateRomecoin処理完了: userId=${userId}`);
		} catch (error) {
			console.error(`[Romecoin] updateRomecoin エラー (userId: ${userId}):`, error);
			console.error(`[Romecoin] エラースタック:`, error.stack);
			throw error;
		}
	});
	
	// ロックを更新
	updateLocks.set(userId, lockPromise);
	
	return lockPromise;
}

// クライアント準備完了時の処理
async function clientReady(client) {
	// Discordクライアントの参照を保存（Discordへの送信用）
	discordClient = client;
	
	// データを読み込む
	const data = loadRomecoinData();
	const dataCount = Object.keys(data).length;
	console.log(`[Romecoin] ロメコインデータを読み込みました（${dataCount}件のエントリ）`);
	
	// データが空の場合、警告を出力
	if (dataCount === 0) {
		console.warn('[Romecoin] ⚠️ 警告: ロメコインデータが空です。バックアップからの復元を試みてください。');
	}
}

// インタラクション作成時の処理
async function interactionCreate(interaction) {
	// ロメコインランキングコマンドの処理
	if (interaction.isChatInputCommand() && interaction.commandName === 'romecoin_ranking') {
		try {
			const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
			const notionManager = require('./notion');
			const botUserId = interaction.client.user?.id;
			
			// クールダウン（30秒）
			const guildId = interaction.guild?.id || 'global';
			const cooldownKey = `romecoin_ranking_${guildId}`;
			const lastUsed = romecoin_ranking_cooldowns?.get(cooldownKey) || 0;
			const cooldownTime = 30 * 1000;
			const now = Date.now();
			
			if (now - lastUsed < cooldownTime) {
				const remainSec = Math.ceil((cooldownTime - (now - lastUsed)) / 1000);
				return interaction.reply({
					content: `⏰ クールダウン中です（残り${remainSec}秒）`,
					ephemeral: true,
				});
			}
			
			// クールダウンを更新
			if (!romecoin_ranking_cooldowns) {
				romecoin_ranking_cooldowns = new Map();
			}
			romecoin_ranking_cooldowns.set(cooldownKey, now);
			
			await interaction.deferReply();
			
			// ロメコインデータを取得（最新のデータを読み込む）
			const data = loadRomecoinData();
			
			// 全ユーザーのデータを取得（預金込みの合計で計算）
			const userData = await Promise.all(
				Object.entries(data)
					.filter(([key, value]) => typeof value === 'number' && value > 0)
					.map(async ([key, value]) => {
						const isNotionName = !/^\d+$/.test(key);
						let discordId = key;
						let notionName = null;

						if (isNotionName) {
							discordId = (await notionManager.getDiscordId(key)) || key;
							if (discordId === botUserId) return null;
							notionName = key;
						} else {
							// Discord IDからNotion名を取得
							notionName = await notionManager.getNotionName(discordId).catch(() => null);
							if (discordId === botUserId) return null;
						}

						// 預金を含めた合計を計算
						const totalValue = await getTotalBalance(discordId);

						return { key, discordId, displayName: isNotionName ? key : null, notionName, value: totalValue };
					})
			);
			
			// nullを除外してソート
			const validData = userData.filter((item) => item !== null);
			validData.sort((a, b) => b.value - a.value);
			
			// ページネーション用のデータを保存（ユーザーごと）
			// キャッシュキーはアンダースコアを含まない形式にする（パースしやすくするため）
			const cacheKeyTimestamp = Date.now();
			const rankingCacheKey = `${interaction.user.id}_${cacheKeyTimestamp}`;
			rankingCache.set(rankingCacheKey, {
				data: validData,
				timestamp: cacheKeyTimestamp
			});
			
			// 1ページ目を表示（1ページあたり10名）
			const page = 1;
			const itemsPerPage = 10;
			const startIndex = (page - 1) * itemsPerPage;
			const endIndex = startIndex + itemsPerPage;
			const pageData = validData.slice(startIndex, endIndex);
			const totalPages = Math.ceil(validData.length / itemsPerPage);
			
			const rankingText = pageData
				.map((item, index) => {
					const rank = startIndex + index + 1;
					const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
					const displayName = item.notionName 
						? `${item.notionName} (<@${item.discordId}>)` 
						: (item.displayName || `<@${item.discordId}>`);
					return `${medal} ${displayName}: ${ROMECOIN_EMOJI}${item.value.toLocaleString()}`;
				})
				.join('\n');
			
			const embed = new EmbedBuilder()
				.setTitle('💰 ロメコインランキング')
				.setDescription(rankingText || 'ランキングデータがありません')
				.setFooter({ text: `ページ ${page}/${totalPages} | 総ユーザー数: ${validData.length}人` })
				.setColor(0xffd700)
				.setTimestamp();
			
			// ページネーションボタンを作成
			const row = new ActionRowBuilder();
			const prevButton = new ButtonBuilder()
				.setCustomId(`romecoin_ranking_prev_${rankingCacheKey}_${page}`)
				.setLabel('前へ')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page === 1);
			const nextButton = new ButtonBuilder()
				.setCustomId(`romecoin_ranking_next_${rankingCacheKey}_${page}`)
				.setLabel('次へ')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page >= totalPages);
			
			row.addComponents(prevButton, nextButton);
			
			await interaction.editReply({ embeds: [embed], components: [row] });
		} catch (error) {
			console.error('[Romecoin] ランキングエラー:', error);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true }).catch(() => {});
			} else {
				await interaction.editReply({ content: 'エラーが発生しました。' }).catch(() => {});
			}
		}
	}
	
	// ページネーションボタンの処理
	if (interaction.isButton() && interaction.customId.startsWith('romecoin_ranking_')) {
		try {
			const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
			const notionManager = require('./notion');
			
			// customIdの形式: romecoin_ranking_{action}_{userId}_{timestamp}_{currentPage}
			// 例: romecoin_ranking_prev_123456789_1704067200000_1
			const parts = interaction.customId.split('_');
			if (parts.length < 6) {
				return interaction.reply({ content: '❌ 無効なボタンです。', ephemeral: true }).catch(() => {});
			}
			
			const action = parts[2]; // 'prev' or 'next'
			const userId = parts[3];
			const timestamp = parts[4];
			const cacheKey = `${userId}_${timestamp}`; // キャッシュキーを再構築
			const currentPage = parseInt(parts[5]) || 1;
			
			// キャッシュからデータを取得
			const cacheEntry = rankingCache.get(cacheKey);
			if (!cacheEntry || !cacheEntry.data) {
				return interaction.reply({ content: '❌ ランキングデータの有効期限が切れました。再度コマンドを実行してください。', ephemeral: true }).catch(() => {});
			}
			const validData = cacheEntry.data;
			
			// ページを計算
			const itemsPerPage = 10;
			let newPage = currentPage;
			if (action === 'prev' && currentPage > 1) {
				newPage = currentPage - 1;
			} else if (action === 'next') {
				const totalPages = Math.ceil(validData.length / itemsPerPage);
				if (currentPage < totalPages) {
					newPage = currentPage + 1;
				}
			}
			
			// ページデータを取得
			const startIndex = (newPage - 1) * itemsPerPage;
			const endIndex = startIndex + itemsPerPage;
			const pageData = validData.slice(startIndex, endIndex);
			const totalPages = Math.ceil(validData.length / itemsPerPage);
			
			const rankingText = pageData
				.map((item, index) => {
					const rank = startIndex + index + 1;
					const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
					const displayName = item.notionName 
						? `${item.notionName} (<@${item.discordId}>)` 
						: (item.displayName || `<@${item.discordId}>`);
					return `${medal} ${displayName}: ${ROMECOIN_EMOJI}${item.value.toLocaleString()}`;
				})
				.join('\n');
			
			const embed = new EmbedBuilder()
				.setTitle('💰 ロメコインランキング')
				.setDescription(rankingText || 'ランキングデータがありません')
				.setFooter({ text: `ページ ${newPage}/${totalPages} | 総ユーザー数: ${validData.length}人` })
				.setColor(0xffd700)
				.setTimestamp();
			
			// ページネーションボタンを作成
			const row = new ActionRowBuilder();
			const prevButton = new ButtonBuilder()
				.setCustomId(`romecoin_ranking_prev_${cacheKey}_${newPage}`)
				.setLabel('前へ')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(newPage === 1);
			const nextButton = new ButtonBuilder()
				.setCustomId(`romecoin_ranking_next_${cacheKey}_${newPage}`)
				.setLabel('次へ')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(newPage >= totalPages);
			
			row.addComponents(prevButton, nextButton);
			
			await interaction.update({ embeds: [embed], components: [row] });
		} catch (error) {
			console.error('[Romecoin] ページネーションエラー:', error);
			try {
				if (interaction.deferred || interaction.replied) {
					await interaction.editReply({ content: '❌ ページ切り替え中にエラーが発生しました。', components: [] }).catch(() => {});
				} else {
					await interaction.reply({ content: '❌ ページ切り替え中にエラーが発生しました。', ephemeral: true }).catch(() => {});
				}
			} catch (replyErr) {
				console.error('[Romecoin] エラーレスポンス送信失敗:', replyErr);
			}
		}
	}
}

// メッセージ作成時の処理
async function messageCreate(message) {
	try {
		// Botのメッセージは無視
		if (message.author.bot) {
			return;
		}

		// メインチャンネル以外は無視
		const { MAIN_CHANNEL_ID, RADIATION_ROLE_ID } = require('../constants');
		if (message.channel.id !== MAIN_CHANNEL_ID) {
			return;
		}

		// 被爆ロールチェック：被爆ロールを持っている場合はロメコインを付与しない
		if (message.member && RADIATION_ROLE_ID && message.member.roles.cache.has(RADIATION_ROLE_ID)) {
			return;
		}

		// クールダウン管理（1分ごとに1回のみ付与）
		const userId = message.author.id;
		const cooldownKey = `message_reward_${userId}`;
		const lastReward = messageRewardCooldowns?.get(cooldownKey) || 0;
		const cooldownTime = 60 * 1000; // 1分
		const now = Date.now();

		if (now - lastReward < cooldownTime) {
			return; // クールダウン中
		}

		// クールダウンを更新
		if (!messageRewardCooldowns) {
			messageRewardCooldowns = new Map();
		}
		messageRewardCooldowns.set(cooldownKey, now);

		// 基本報酬
		let rewardAmount = 10;

		// 会話参加者数ボーナス（過去5分以内のメッセージ送信者数をカウント）
		// 現在時刻を分単位で取得
		const currentMinute = Math.floor(now / (60 * 1000));
		
		// 過去5分以内の参加者を集計
		const participantSet = new Set();
		for (let i = 0; i < 5; i++) {
			const minuteKey = currentMinute - i;
			const participants = conversationParticipants.get(minuteKey);
			if (participants) {
				participants.forEach(id => participantSet.add(id));
			}
		}
		
		// botと被爆ロールを除外してカウント
		let participantCount = 0;
		for (const participantId of participantSet) {
			// 自分自身は既にカウントされているので除外しない
			if (participantId === userId) continue;
			
			// botチェック
			const participant = message.guild?.members.cache.get(participantId);
			if (participant?.user.bot) continue;
			
			// 被爆ロールチェック
			if (participant && RADIATION_ROLE_ID && participant.roles.cache.has(RADIATION_ROLE_ID)) continue;
			
			participantCount++;
		}
		
		// 会話参加者数ボーナス: 1 + (参加者数/10) → 最大2倍
		const conversationBonus = Math.min(2, 1 + (participantCount / 10));
		rewardAmount = Math.round(rewardAmount * conversationBonus);
		
		// 現在の分に参加者を追加
		if (!conversationParticipants.has(currentMinute)) {
			conversationParticipants.set(currentMinute, new Set());
		}
		conversationParticipants.get(currentMinute).add(userId);
		
		// 古いデータを削除（5分以上前のデータ）
		const cutoffMinute = currentMinute - 5;
		for (const [minuteKey] of conversationParticipants) {
			if (minuteKey < cutoffMinute) {
				conversationParticipants.delete(minuteKey);
			}
		}

		// 深夜ボーナス（6時前）: 1.5倍
		const jst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
		const hour = jst.getHours();
		if (hour < 6) {
			rewardAmount = Math.round(rewardAmount * 1.5);
		}

		// 返信チェック（メッセージに返信が含まれている場合）
		if (message.reference && message.reference.messageId) {
			rewardAmount += 5;
		}

		// リアクションボーナスはリアクション追加時に処理されるため、ここでは処理しない
		
		const bonusText = participantCount > 0 ? ` [会話参加者${participantCount}人ボーナス]` : '';
		console.log(`[Romecoin] メッセージ送信報酬: userId=${userId}, amount=${rewardAmount}, hour=${hour}, isReply=${!!(message.reference && message.reference.messageId)}, participants=${participantCount}`);
		
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) + rewardAmount),
			{
				log: true,
				client: message.client,
				reason: `メッセージ送信報酬（メインチャンネル）${bonusText}${hour < 6 ? ' [深夜ボーナス]' : ''}${message.reference && message.reference.messageId ? ' [返信ボーナス]' : ''}`,
				metadata: {
					commandName: 'message_reward',
					channelId: message.channel.id,
					hour: hour,
					isReply: !!(message.reference && message.reference.messageId),
					participantCount: participantCount,
				},
			}
		);
	} catch (error) {
		console.error('[Romecoin] メッセージ送信報酬エラー:', error);
		// エラーが発生しても処理を続行（メッセージ送信を妨げない）
	}
}

// リアクション追加時の処理
async function messageReactionAdd(reaction, user) {
	try {
		// Botのリアクションは無視
		if (user.bot) {
			return;
		}

		// メインチャンネル以外は無視
		const { MAIN_CHANNEL_ID, RADIATION_ROLE_ID } = require('../constants');
		if (reaction.message.channel.id !== MAIN_CHANNEL_ID) {
			return;
		}

		// 被爆ロールチェック
		const member = reaction.message.guild?.members.cache.get(user.id);
		if (member && RADIATION_ROLE_ID && member.roles.cache.has(RADIATION_ROLE_ID)) {
			return;
		}

		// 自分のメッセージへのリアクションは無視（自己リアクション防止）
		if (reaction.message.author.id === user.id) {
			return;
		}

		// クールダウン管理（1分ごとに1回のみ付与）
		const userId = user.id;
		const cooldownKey = `reaction_reward_${userId}_${reaction.message.id}`;
		const lastReward = messageRewardCooldowns?.get(cooldownKey) || 0;
		const cooldownTime = 60 * 1000; // 1分
		const now = Date.now();

		if (now - lastReward < cooldownTime) {
			return; // クールダウン中
		}

		// クールダウンを更新
		if (!messageRewardCooldowns) {
			messageRewardCooldowns = new Map();
		}
		messageRewardCooldowns.set(cooldownKey, now);

		// リアクションボーナス: +5コイン
		const rewardAmount = 5;
		
		console.log(`[Romecoin] リアクションボーナス: userId=${userId}, amount=${rewardAmount}, messageId=${reaction.message.id}`);
		
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) + rewardAmount),
			{
				log: true,
				client: reaction.message.client,
				reason: `リアクションボーナス（メインチャンネル）`,
				metadata: {
					commandName: 'reaction_reward',
					channelId: reaction.message.channel.id,
					messageId: reaction.message.id,
				},
			}
		);
	} catch (error) {
		console.error('[Romecoin] リアクションボーナスエラー:', error);
		// エラーが発生しても処理を続行
	}
}

// ボイスステート更新時の処理
async function handleVoiceStateUpdate(oldState, newState) {
	try {
		const { RADIATION_ROLE_ID } = require('../constants');
		const userId = newState.member?.id;
		
		if (!userId) {
			return;
		}

		// VCから退出した場合
		if (oldState?.channel && !newState.channel) {
			const vcData = vcParticipants.get(userId);
			if (vcData && vcData.intervalId) {
				clearInterval(vcData.intervalId);
				vcParticipants.delete(userId);
				console.log(`[Romecoin] VC退出: userId=${userId}`);
			}
			return;
		}

		// 新しいVCチャンネルに参加した場合
		if (newState.channel && (!oldState?.channel || oldState.channel.id !== newState.channel.id)) {
			// Botは無視
			if (newState.member.user.bot) {
				return;
			}

			// 被爆ロールチェック
			if (RADIATION_ROLE_ID && newState.member.roles.cache.has(RADIATION_ROLE_ID)) {
				return;
			}

			// 既存のインターバルをクリア（チャンネル移動時）
			const existingVcData = vcParticipants.get(userId);
			if (existingVcData && existingVcData.intervalId) {
				clearInterval(existingVcData.intervalId);
			}

			// 定期的にVC参加者にロメコインを付与する処理
			const vcRewardInterval = setInterval(async () => {
				try {
					// ユーザーがまだVCに参加しているか確認
					const member = newState.guild.members.cache.get(userId);
					if (!member || !member.voice.channel || member.voice.channel.id !== newState.channel.id) {
						const vcData = vcParticipants.get(userId);
						if (vcData && vcData.intervalId) {
							clearInterval(vcData.intervalId);
							vcParticipants.delete(userId);
						}
						return;
					}

					// ミュート状態チェック（selfMuteまたはserverMuteがtrueの場合は付与しない）
					if (member.voice.mute || member.voice.selfMute) {
						return;
					}

					// VC参加者数をカウント（botと被爆ロールは除外、ミュート中も除外）
					const channel = member.voice.channel;
					let participantCount = 0;
					for (const [memberId, vcMember] of channel.members) {
						if (vcMember.user.bot) continue;
						if (RADIATION_ROLE_ID && vcMember.roles.cache.has(RADIATION_ROLE_ID)) continue;
						if (vcMember.voice.mute || vcMember.voice.selfMute) continue; // ミュート中はカウントしない
						participantCount++;
					}

					// 参加者数が2人以上の場合のみ付与（1人では会話にならない）
					if (participantCount < 2) {
						return;
					}

					// クールダウン管理（1分ごとに1回のみ付与）
					const vcData = vcParticipants.get(userId);
					const now = Date.now();
					if (vcData && now - vcData.lastReward < 60 * 1000) {
						return; // クールダウン中
					}

					// クールダウンを更新
					if (vcData) {
						vcData.lastReward = now;
					}

					// VC参加報酬: 固定額（参加者数が2人以上の場合）
					const rewardAmount = 10; // メッセージ送信報酬と同額
					
					console.log(`[Romecoin] VC参加報酬: userId=${userId}, amount=${rewardAmount}, participants=${participantCount}, channel=${channel.name}`);
					
					await updateRomecoin(
						userId,
						(current) => Math.round((current || 0) + rewardAmount),
						{
							log: true,
							client: newState.client,
							reason: `VC参加報酬（${channel.name}、参加者${participantCount}人）`,
							metadata: {
								commandName: 'vc_reward',
								channelId: channel.id,
								channelName: channel.name,
								participantCount: participantCount,
							},
						}
					);
				} catch (error) {
					console.error('[Romecoin] VC参加報酬エラー:', error);
					const vcData = vcParticipants.get(userId);
					if (vcData && vcData.intervalId) {
						clearInterval(vcData.intervalId);
						vcParticipants.delete(userId);
					}
				}
			}, 60 * 1000); // 1分ごと

			// VC参加者情報を保存
			vcParticipants.set(userId, {
				channelId: newState.channel.id,
				lastReward: 0,
				intervalId: vcRewardInterval,
			});

			console.log(`[Romecoin] VC参加: userId=${userId}, channel=${newState.channel.name}`);
		}
	} catch (error) {
		console.error('[Romecoin] VC参加処理エラー:', error);
	}
}

// データを再読み込み（API移行後に使用）
function reloadRomecoinData() {
	console.log('[Romecoin] データを再読み込みします...');
	romecoin_data = null; // グローバル変数をリセット
	loadRomecoinData(); // ファイルから再読み込み
	console.log('[Romecoin] データの再読み込みが完了しました');
}

module.exports = {
	clientReady,
	interactionCreate,
	messageCreate,
	messageReactionAdd,
	handleVoiceStateUpdate,
	getRomecoinData,
	getRomecoin,
	updateRomecoin,
	logRomecoinChange,
	getTotalBalance,
	reloadRomecoinData,
};
