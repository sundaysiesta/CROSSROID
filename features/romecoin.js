const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getData, updateData, migrateData } = require('./dataAccess');
const { ROMECOIN_LOG_CHANNEL_ID } = require('../constants');

const ROMECOIN_DATA_FILE = path.join(__dirname, '..', 'romecoin_data.json');
const ROMECOIN_DATA_BACKUP_FILE = path.join(__dirname, '..', 'romecoin_data.json.backup');
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';

// 数値の最大値（JavaScriptの安全な整数範囲内）
const MAX_SAFE_VALUE = Number.MAX_SAFE_INTEGER; // 2^53 - 1 = 9007199254740991

// グローバル変数としてromecoin_dataを初期化
let romecoin_data = null;

// 同時実行制御用のロック（ユーザーIDごと）
const updateLocks = new Map();

// ランキングコマンドのクールダウン
let romecoin_ranking_cooldowns = new Map();

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
					saveRomecoinData();
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

// データ保存
function saveRomecoinData() {
	if (romecoin_data === null) {
		console.warn('[Romecoin] saveRomecoinData: romecoin_dataがnullです。保存をスキップします。');
		return;
	}
	try {
		const dataCount = Object.keys(romecoin_data).length;
		console.log(`[Romecoin] saveRomecoinData: エントリ数=${dataCount}`);
		
		// バックアップを作成（既存のファイルがある場合）
		if (fs.existsSync(ROMECOIN_DATA_FILE)) {
			try {
				fs.copyFileSync(ROMECOIN_DATA_FILE, ROMECOIN_DATA_BACKUP_FILE);
				console.log(`[Romecoin] バックアップ作成完了: ${ROMECOIN_DATA_BACKUP_FILE}`);
			} catch (e) {
				console.warn('[Romecoin] バックアップ作成エラー（無視）:', e);
			}
		}
		// メインファイルに保存
		const jsonData = JSON.stringify(romecoin_data, null, 2);
		fs.writeFileSync(ROMECOIN_DATA_FILE, jsonData);
		console.log(`[Romecoin] データ保存完了: ${ROMECOIN_DATA_FILE} (${jsonData.length} bytes)`);
	} catch (e) {
		console.error('[Romecoin] データ保存エラー:', e);
		console.error('[Romecoin] エラースタック:', e.stack);
	}
}

// 定期的にデータを保存（1分ごと）
setInterval(() => {
	saveRomecoinData();
}, 60 * 1000);

// ロメコインデータを取得
function getRomecoinData() {
	return loadRomecoinData();
}

// ロメコイン残高を取得
async function getRomecoin(userId) {
	// 最新のデータを読み込む
	const data = loadRomecoinData();
	await migrateData(userId, data);
	const balance = await getData(userId, data, 0);
	// 負の値や無効な値を0に正規化
	const normalizedBalance = Math.max(0, Math.min(MAX_SAFE_VALUE, Number(balance) || 0));
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
			
			// 目標残高の検証
			const targetValidation = validateAmount(targetBalance);
			if (!targetValidation.valid) {
				throw new Error(`目標残高が無効です: ${targetValidation.error}`);
			}
			
			// 目標残高を最大値以内に制限
			const safeTargetBalance = Math.min(MAX_SAFE_VALUE, Math.max(0, Math.round(targetBalance)));
			console.log(`[Romecoin] 安全な目標残高: ${safeTargetBalance} (userId=${userId})`);
			
			// 預金から自動的に引き出す機能（useDeposit オプションが true の場合）
			if (options.useDeposit) {
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
						await updateData(userId, data, () => safeTargetBalance);
						
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
							await updateData(userId, data, () => finalBalance);
							
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
							await updateData(userId, data, () => safeTargetBalance);
							
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
					await updateData(userId, data, () => safeTargetBalance);
				}
			} else {
				// 預金から自動引き出しを使用しない場合は通常通り更新
				console.log(`[Romecoin] 通常更新を実行: userId=${userId}, safeTargetBalance=${safeTargetBalance}`);
				await updateData(userId, data, () => safeTargetBalance);
				console.log(`[Romecoin] データ更新完了: userId=${userId}`);
			}
			
			// データを保存
			console.log(`[Romecoin] データ保存を実行: userId=${userId}`);
			saveRomecoinData();
			console.log(`[Romecoin] データ保存完了: userId=${userId}`);
			
			// 変更後の残高を取得（正規化済み）
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

						if (isNotionName) {
							discordId = (await notionManager.getDiscordId(key)) || key;
							if (discordId === botUserId) return null;
						}

						// 預金を含めた合計を計算
						const totalValue = await getTotalBalance(discordId);

						return { key, discordId, displayName: isNotionName ? key : null, value: totalValue };
					})
			);
			
			// nullを除外してソート
			const validData = userData.filter((item) => item !== null);
			validData.sort((a, b) => b.value - a.value);
			
			// 上位10名を表示
			const top10 = validData.slice(0, 10);
			
			const rankingText = top10
				.map((item, index) => {
					const rank = index + 1;
					const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
					const displayName = item.displayName || `<@${item.discordId}>`;
					return `${medal} ${displayName}: ${ROMECOIN_EMOJI}${item.value.toLocaleString()}`;
				})
				.join('\n');
			
			const embed = new EmbedBuilder()
				.setTitle('💰 ロメコインランキング')
				.setDescription(rankingText || 'ランキングデータがありません')
				.setColor(0xffd700)
				.setTimestamp();
			
			await interaction.editReply({ embeds: [embed] });
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
		// ページネーション機能は将来の実装用（現在は簡易版のみ）
	}
}

// メッセージ作成時の処理
async function messageCreate(message) {
	// 特に処理なし
}

// リアクション追加時の処理
async function messageReactionAdd(reaction, user) {
	// 特に処理なし
}

// ボイスステート更新時の処理
async function handleVoiceStateUpdate(oldState, newState) {
	// 特に処理なし
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
};
