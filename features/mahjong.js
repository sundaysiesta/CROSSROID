const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { updateRomecoin } = require('./romecoin');
const { checkAdmin } = require('../utils');
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';

const MAHJONG_DATA_FILE = path.join(__dirname, '..', 'mahjong_data.json');
const WAIT_TIMEOUT_MS = 30 * 1000; // 30秒

// データ読み込み
function loadMahjongData() {
	if (fs.existsSync(MAHJONG_DATA_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(MAHJONG_DATA_FILE, 'utf8'));
		} catch (e) {
			console.error('[麻雀] データ読み込みエラー:', e);
			return {};
		}
	}
	return {};
}

// データ保存
function saveMahjongData(data) {
	try {
		fs.writeFileSync(MAHJONG_DATA_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error('[麻雀] データ保存エラー:', e);
	}
}

// 既存の試合記録から統計を再計算（過去のデータも反映）
function recalculateStats(data) {
	// 統計をリセット
	data.stats = {};
	
	// すべての試合記録を走査
	for (const [tableId, record] of Object.entries(data)) {
		// statsオブジェクトはスキップ
		if (tableId === 'stats') continue;
		
		// 完了した試合のみをカウント
		if (!record.completedAt || !record.players || !record.romecoinChanges) continue;
		
		const allPlayers = record.players;
		const romecoinChanges = record.romecoinChanges;
		
		for (let i = 0; i < allPlayers.length && i < romecoinChanges.length; i++) {
			const playerId = allPlayers[i];
			const romecoinChange = romecoinChanges[i];
			
			if (!data.stats[playerId]) {
				data.stats[playerId] = {
					totalWinnings: 0,
					totalLosses: 0,
					gamesPlayed: 0,
					gamesWon: 0,
				};
			}
			
			data.stats[playerId].gamesPlayed++;
			if (romecoinChange > 0) {
				data.stats[playerId].totalWinnings += romecoinChange;
				data.stats[playerId].gamesWon++;
			} else if (romecoinChange < 0) {
				data.stats[playerId].totalLosses += Math.abs(romecoinChange);
			}
		}
	}
}

// 麻雀データ取得（未使用だが将来の拡張用に保持）

// 進行中のテーブル管理
const activeTables = new Map(); // tableId -> { host, players, rate, gameType, message, agreedPlayers, createdAt }

async function createTable(interaction, client) {
	try {
		const host = interaction.user;
		const rate = interaction.options.getNumber('rate');
		const player1 = interaction.options.getUser('player1');
		const player2 = interaction.options.getUser('player2');
		const player3 = interaction.options.getUser('player3');

		// バリデーション
		if (rate < 0.1 || rate > 1) {
			return interaction.reply({
				content: 'レートは0.1以上1以下で指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const players = [player1, player2];
		if (player3) {
			players.push(player3);
		}

		// 重複チェック（ホストも含める）
		const allParticipants = [host, ...players];
		const uniquePlayers = new Set(allParticipants.map((p) => p.id));
		if (uniquePlayers.size !== allParticipants.length) {
			return interaction.reply({
				content: '参加メンバーに重複があります。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// ボットチェック
		if (players.some((p) => p.bot)) {
			return interaction.reply({
				content: 'Botは参加できません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 所持金チェック（マイナスの場合は参加不可）
		const balanceChecks = await Promise.all(
			allParticipants.map(async (participant) => {
				const balance = await require('./romecoin').getRomecoin(participant.id);
				return { participant, balance };
			})
		);

		const insufficientBalanceUsers = balanceChecks.filter((check) => check.balance < 0);
		if (insufficientBalanceUsers.length > 0) {
			const userList = insufficientBalanceUsers
				.map((check) => `<@${check.participant.id}> (${ROMECOIN_EMOJI}${check.balance.toLocaleString()})`)
				.join('\n');
			return interaction.reply({
				content: `所持金がマイナスのため、以下のユーザーは麻雀に参加できません：\n${userList}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		const gameType = player3 ? '四麻' : '三麻';
		const tableId = `mahjong_${host.id}_${Date.now()}`;

		// テーブル作成
		const table = {
			host: host.id,
			players: players.map((p) => p.id),
			rate: rate,
			gameType: gameType,
			agreedPlayers: [],
			createdAt: Date.now(),
			status: 'waiting',
		};

		activeTables.set(tableId, table);

		// 同意ボタンを作成
		const buttons = players.map((player) => {
			// Discordのボタンラベルは80文字制限
			const label = `${player.displayName}が同意`.substring(0, 80);
			return new ButtonBuilder()
				.setCustomId(`mahjong_agree_${tableId}|${player.id}`)
				.setLabel(label)
				.setStyle(ButtonStyle.Success)
				.setEmoji('✅');
		});

		// キャンセルボタンを追加（部屋主のみ）
		const cancelButton = new ButtonBuilder()
			.setCustomId(`mahjong_cancel_${tableId}`)
			.setLabel('開催中止')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('❌');

		const row = new ActionRowBuilder().addComponents([...buttons, cancelButton]);

		const embed = new EmbedBuilder()
			.setTitle('🀄 賭け麻雀テーブル作成')
			.setDescription(
				`**部屋主:** ${host}\n**レート:** ${rate}ロメコイン/点\n**ゲームタイプ:** ${gameType}\n\n**参加メンバー:**\n1. ${host} (部屋主)\n${players.map((p, i) => `${i + 2}. ${p}`).join('\n')}\n\n**同意待ち:** ${players.map((p) => p).join(', ')}`
			)
			.setColor(0x00ff00)
			.setTimestamp();

		// 参加メンバーをメンション
		const mentions = players.map((p) => `<@${p.id}>`).join(' ');

		const reply = await interaction.reply({
			content: `${mentions} 賭け麻雀テーブルへの参加に同意してください。`,
			embeds: [embed],
			components: [row],
		});

		table.message = reply.id;
		activeTables.set(tableId, table);

		// タイムアウト処理
		setTimeout(async () => {
			const currentTable = activeTables.get(tableId);
			if (currentTable && currentTable.status === 'waiting') {
				const remainingPlayers = currentTable.players.filter(
					(playerId) => !currentTable.agreedPlayers.includes(playerId)
				);
				if (remainingPlayers.length > 0) {
					const embed = new EmbedBuilder()
						.setTitle('⏰ タイムアウト')
						.setDescription(
							`以下のメンバーの同意が得られなかったため、テーブルはキャンセルされました。\n${remainingPlayers.map((playerId) => `<@${playerId}>`).join(', ')}`
						)
						.setColor(0xff0000)
						.setTimestamp();

					try {
						const message = await interaction.channel.messages.fetch(currentTable.message).catch(() => null);
						if (message) {
							await message.edit({ embeds: [embed], components: [] });
						}
					} catch (e) {
						console.error('[麻雀] タイムアウトメッセージ編集エラー:', e);
					}
					activeTables.delete(tableId);
				}
			}
		}, WAIT_TIMEOUT_MS);
	} catch (error) {
		console.error('[麻雀] テーブル作成エラー:', error);
		if (!interaction.replied && !interaction.deferred) {
			try {
				await interaction.reply({
					content: 'エラーが発生しました。',
					flags: [MessageFlags.Ephemeral],
				});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

async function handleAgreement(interaction, client) {
	try {
		const parts = interaction.customId.split('|');
		if (parts.length !== 2) {
			if (interaction.replied || interaction.deferred) return;
			return interaction.reply({
				content: '無効なボタンです。',
				flags: [MessageFlags.Ephemeral],
			}).catch(() => {});
		}
		const tableId = parts[0].replace('mahjong_agree_', '');
		const playerId = parts[1];
		const table = activeTables.get(tableId);

		if (!table) {
			if (interaction.replied || interaction.deferred) return;
			return interaction.reply({
				content: 'このテーブルは既に終了しています。',
				flags: [MessageFlags.Ephemeral],
			}).catch(() => {});
		}

		if (table.status !== 'waiting') {
			if (interaction.replied || interaction.deferred) return;
			return interaction.reply({
				content: 'このテーブルは既に開始されています。',
				flags: [MessageFlags.Ephemeral],
			}).catch(() => {});
		}

		if (interaction.user.id !== playerId) {
			if (interaction.replied || interaction.deferred) return;
			return interaction.reply({
				content: 'あなたはこのテーブルの参加メンバーではありません。',
				flags: [MessageFlags.Ephemeral],
			}).catch(() => {});
		}

		if (table.agreedPlayers.includes(playerId)) {
			if (interaction.replied || interaction.deferred) return;
			return interaction.reply({
				content: 'あなたは既に同意しています。',
				flags: [MessageFlags.Ephemeral],
			}).catch(() => {});
		}

		// 所持金チェック（マイナスの場合は同意不可）
		const balance = await require('./romecoin').getRomecoin(interaction.user.id);
		if (balance < 0) {
			if (interaction.replied || interaction.deferred) return;
			return interaction.reply({
				content: `所持金がマイナス(${ROMECOIN_EMOJI}${balance.toLocaleString()})のため、同意できません。`,
				flags: [MessageFlags.Ephemeral],
			}).catch(() => {});
		}

		table.agreedPlayers.push(playerId);

		// allPlayersを構築（部屋主の重複を除去）
		// 既存データでtable.playersに部屋主が含まれている可能性があるため、重複を除去
		const playersWithoutHost = table.players.filter((p) => p !== table.host);
		const allPlayers = [table.host, ...playersWithoutHost];
		const remainingPlayers = table.players.filter((p) => !table.agreedPlayers.includes(p));

		if (remainingPlayers.length === 0) {
			// 全員同意したので試合開始
			table.status = 'in_progress';
			table.startedAt = Date.now();

			// 試合開始時にテーブルをデータベースに保存（結果入力時に使用）
			const data = loadMahjongData();
			data[tableId] = {
				tableId: tableId,
				host: table.host,
				players: table.players, // 部屋主を含まない元のplayers配列を保存
				gameType: table.gameType,
				rate: table.rate,
				createdAt: table.createdAt,
				startedAt: table.startedAt,
				status: 'in_progress',
			};
			saveMahjongData(data);

			const embed = new EmbedBuilder()
				.setTitle('🀄 試合開始')
				.setDescription(
					`**部屋主:** <@${table.host}>\n**レート:** ${table.rate}ロメコイン/点\n**ゲームタイプ:** ${table.gameType}\n\n**参加メンバー:**\n${allPlayers.map((p, i) => `${i + 1}. <@${p}>`).join('\n')}\n\n✅ **全員の同意が得られました。試合を開始してください。**\n\n試合終了後、部屋主は以下のコマンドで点数を入力してください：\n\`/mahjong_result table_id:${tableId} player1_score:部屋主の点数 player2_score:${allPlayers[1] ? 'player1の点数' : ''} player3_score:${allPlayers[2] ? 'player2の点数' : ''}${table.gameType === '四麻' ? ' player4_score:player3の点数' : ''}\``
				)
				.setColor(0x00ff00)
				.setTimestamp();

			if (interaction.replied || interaction.deferred) return;
			await interaction.update({ embeds: [embed], components: [] }).catch(() => {});
		} else {
			// まだ同意待ち
			const embed = new EmbedBuilder()
				.setTitle('🀄 賭け麻雀テーブル')
				.setDescription(
					`**部屋主:** <@${table.host}>\n**レート:** ${table.rate}ロメコイン/点\n**ゲームタイプ:** ${table.gameType}\n\n**参加メンバー:**\n${allPlayers.map((p, i) => `${i + 1}. <@${p}>`).join('\n')}\n\n**同意済み:** ${table.agreedPlayers.map((p) => `<@${p}>`).join(', ')}\n**同意待ち:** ${remainingPlayers.map((p) => `<@${p}>`).join(', ')}`
				)
				.setColor(0xffff00)
				.setTimestamp();

			// ボタンを更新（同意済みのボタンを無効化）
			const buttonPromises = table.players.map(async (playerId) => {
				const isAgreed = table.agreedPlayers.includes(playerId);
				const user = await client.users.fetch(playerId).catch(() => null);
				const displayName = user ? user.displayName : `ユーザー${playerId}`;
				// Discordのボタンラベルは80文字制限
				const label = `${displayName}が同意`.substring(0, 80);
				return new ButtonBuilder()
					.setCustomId(`mahjong_agree_${tableId}|${playerId}`)
					.setLabel(label)
					.setStyle(isAgreed ? ButtonStyle.Secondary : ButtonStyle.Success)
					.setEmoji('✅')
					.setDisabled(isAgreed);
			});

			const buttons = await Promise.all(buttonPromises);
			// キャンセルボタンも追加
			const cancelButton = new ButtonBuilder()
				.setCustomId(`mahjong_cancel_${tableId}`)
				.setLabel('開催中止')
				.setStyle(ButtonStyle.Danger)
				.setEmoji('❌');
			const row = new ActionRowBuilder().addComponents([...buttons, cancelButton]);

			if (interaction.replied || interaction.deferred) return;
			await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
		}

		activeTables.set(tableId, table);
	} catch (error) {
		console.error('[麻雀] 同意処理エラー:', error);
		if (error.code !== 10062 && error.code !== 40060) {
			try {
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: 'エラーが発生しました。',
						flags: [MessageFlags.Ephemeral],
					});
				}
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

async function handleResult(interaction, client) {
	let lockTimestamp = null; // エラーハンドリングで使用するため、関数スコープで定義
	let deferred = false;
	
	// 早期にdeferReplyを実行してタイムアウトを防ぐ
	try {
		await interaction.deferReply();
		deferred = true;
	} catch (deferError) {
		// 既にdeferredまたはrepliedの場合は無視
		if (deferError.code !== 10062 && deferError.code !== 40060) {
			console.error('[麻雀] deferReplyエラー:', deferError);
		}
	}
	
	try {
		const tableId = interaction.options.getString('table_id');
		const hostScore = interaction.options.getInteger('player1_score'); // 部屋主の点数
		const player1Score = interaction.options.getInteger('player2_score');
		const player2Score = interaction.options.getInteger('player3_score');
		const player3Score = interaction.options.getInteger('player4_score'); // 四麻の場合のみ

		let table = activeTables.get(tableId);

		if (!table) {
			// データベースから読み込む
			const data = loadMahjongData();
			const savedTable = data[tableId];
			if (!savedTable) {
				if (deferred) {
					return interaction.editReply({
						content: 'テーブルが見つかりませんでした。',
					});
				} else {
					return interaction.reply({
						content: 'テーブルが見つかりませんでした。',
						flags: [MessageFlags.Ephemeral],
					});
				}
			}
			// 保存されたテーブルを使用
			table = savedTable;
		}

		if (interaction.user.id !== table.host) {
			if (deferred) {
				return interaction.editReply({
					content: '部屋主のみが点数を入力できます。',
				});
			} else {
				return interaction.reply({
					content: '部屋主のみが点数を入力できます。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// テーブルの状態チェック
		if (table.status && table.status !== 'in_progress' && table.status !== 'waiting') {
			if (deferred) {
				return interaction.editReply({
					content: 'このテーブルは既に終了しています。',
				});
			} else {
				return interaction.reply({
					content: 'このテーブルは既に終了しています。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// 既に結果が入力されているかチェック（データベースから最新の状態を確認）
		const dataCheck = loadMahjongData();
		const savedTableCheck = dataCheck[tableId];
		if (savedTableCheck && savedTableCheck.completedAt) {
			if (deferred) {
				return interaction.editReply({
					content: 'この試合の結果は既に入力されています。修正する場合は`/mahjong_edit`コマンドを使用してください。',
				});
			} else {
				return interaction.reply({
					content: 'この試合の結果は既に入力されています。修正する場合は`/mahjong_edit`コマンドを使用してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// allPlayersを構築（部屋主の重複を除去）
		// 既存データでtable.playersに部屋主が含まれている可能性があるため、重複を除去
		const playersWithoutHost = table.players.filter((p) => p !== table.host);
		const allPlayers = [table.host, ...playersWithoutHost];
		
		const scores = [hostScore, player1Score, player2Score];
		if (table.gameType === '四麻') {
			if (player3Score === null || player3Score === undefined) {
				if (deferred) {
					return interaction.editReply({
						content: '四麻の場合は4人全員の点数を入力してください。',
					});
				} else {
					return interaction.reply({
						content: '四麻の場合は4人全員の点数を入力してください。',
						flags: [MessageFlags.Ephemeral],
					});
				}
			}
			scores.push(player3Score);
		}
		
		// allPlayersとscoresの長さが一致するか確認
		if (allPlayers.length !== scores.length) {
			if (deferred) {
				return interaction.editReply({
					content: `プレイヤー数と点数数の不一致: プレイヤー${allPlayers.length}人、点数${scores.length}個`,
				});
			} else {
				return interaction.reply({
					content: `プレイヤー数と点数数の不一致: プレイヤー${allPlayers.length}人、点数${scores.length}個`,
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// 点数バリデーション
		if (scores.some((s) => s === null || s === undefined)) {
			if (deferred) {
				return interaction.editReply({
					content: 'すべてのプレイヤーの点数を入力してください。',
				});
			} else {
				return interaction.reply({
					content: 'すべてのプレイヤーの点数を入力してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// 基準点で計算（三麻: 35000点、四麻: 25000点）
		const BASE_SCORE = table.gameType === '四麻' ? 25000 : 35000;
		const scoreDiffs = scores.map((score) => score - BASE_SCORE);

		// 点数整合性チェック（三麻: 合計105000点、四麻: 合計100000点）
		const expectedTotal = table.gameType === '四麻' ? 100000 : 105000;
		const actualTotal = scores.reduce((sum, score) => sum + score, 0);
		if (Math.abs(actualTotal - expectedTotal) > 1) {
			if (deferred) {
				return interaction.editReply({
					content: `点数の合計が正しくありません。${table.gameType === '四麻' ? '四麻' : '三麻'}の合計は${expectedTotal.toLocaleString()}点である必要があります。\n現在の合計: ${actualTotal.toLocaleString()}点`,
				});
			} else {
				return interaction.reply({
					content: `点数の合計が正しくありません。${table.gameType === '四麻' ? '四麻' : '三麻'}の合計は${expectedTotal.toLocaleString()}点である必要があります。\n現在の合計: ${actualTotal.toLocaleString()}点`,
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// 重複実行を防ぐため、ロメコイン更新前にcompletedAtを設定して保存
		const dataLock = loadMahjongData();
		if (dataLock[tableId] && dataLock[tableId].completedAt) {
			if (deferred) {
				return interaction.editReply({
					content: 'この試合の結果は既に入力されています。修正する場合は`/mahjong_edit`コマンドを使用してください。',
				});
			} else {
				return interaction.reply({
					content: 'この試合の結果は既に入力されています。修正する場合は`/mahjong_edit`コマンドを使用してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		}
		
		// 一時的にcompletedAtを設定してロック（ロメコイン更新前に）
		lockTimestamp = Date.now();
		if (!dataLock[tableId]) {
			dataLock[tableId] = {};
		}
		dataLock[tableId].completedAt = lockTimestamp;
		dataLock[tableId].processing = true; // 処理中フラグ
		saveMahjongData(dataLock);

		// ロメコイン計算と更新
		const results = [];
		let romecoinUpdateError = null;
		try {
			for (let i = 0; i < allPlayers.length; i++) {
				const playerId = allPlayers[i];
				const diff = scoreDiffs[i];
				const romecoinChange = Math.round(diff * table.rate);

				const currentBalance = await require('./romecoin').getRomecoin(playerId);
				const newBalance = currentBalance + romecoinChange;

				await updateRomecoin(
					playerId,
					(current) => newBalance,
					{
						log: true,
						client: client,
						reason: `賭け麻雀（${table.gameType}）: ${scores[i]}点`,
						metadata: {
							commandName: 'mahjong_result',
							targetUserId: playerId,
						},
						useDeposit: romecoinChange < 0, // 減額の場合のみ預金から自動引き出し
					}
				);

				results.push({
					player: playerId,
					score: scores[i],
					diff: diff,
					romecoinChange: romecoinChange,
					newBalance: newBalance,
				});
			}
		} catch (error) {
			romecoinUpdateError = error;
			// エラーが発生した場合、ロックを解除
			const dataUnlock = loadMahjongData();
			if (dataUnlock[tableId] && dataUnlock[tableId].completedAt === lockTimestamp) {
				delete dataUnlock[tableId].completedAt;
				delete dataUnlock[tableId].processing;
				saveMahjongData(dataUnlock);
			}
			throw error;
		}
		
		// ロメコイン更新後に再度チェック（他のプロセスが既に処理した可能性がある）
		const dataRecheck = loadMahjongData();
		if (dataRecheck[tableId] && dataRecheck[tableId].completedAt && dataRecheck[tableId].completedAt !== lockTimestamp) {
			// 他のプロセスが既に処理した場合は、ロメコインの変更を元に戻す
			console.error(`[麻雀] 重複実行検出（ロメコイン更新後）: tableId=${tableId}, lockTimestamp=${lockTimestamp}, existingCompletedAt=${dataRecheck[tableId].completedAt}`);
			// ロメコインの変更を元に戻す
			for (let i = 0; i < allPlayers.length; i++) {
				const playerId = allPlayers[i];
				const romecoinChange = results[i].romecoinChange;
				try {
					await updateRomecoin(
						playerId,
						(current) => Math.round((current || 0) - romecoinChange),
						{
							log: true,
							client: client,
							reason: `賭け麻雀（重複実行のため取り消し）: ${scores[i]}点`,
							metadata: {
								commandName: 'mahjong_result',
								targetUserId: playerId,
							},
						}
					);
				} catch (rollbackError) {
					console.error(`[麻雀] ロメコイン取り消しエラー: playerId=${playerId}`, rollbackError);
				}
			}
			if (deferred) {
				return interaction.editReply({
					content: 'この試合の結果は既に入力されています。修正する場合は`/mahjong_edit`コマンドを使用してください。',
				});
			} else {
				return interaction.reply({
					content: 'この試合の結果は既に入力されています。修正する場合は`/mahjong_edit`コマンドを使用してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		}

		// 試合記録を保存（completedAtは既に設定済み）
		const matchRecord = {
			tableId: tableId,
			host: table.host,
			players: allPlayers,
			gameType: table.gameType,
			rate: table.rate,
			scores: scores,
			scoreDiffs: scoreDiffs,
			romecoinChanges: results.map((r) => r.romecoinChange),
			createdAt: table.createdAt,
			completedAt: lockTimestamp, // ロック時に設定したタイムスタンプを使用
		};

		const data = loadMahjongData();
		// ロックが有効であることを確認（他のプロセスが既に処理した場合は、上記のチェックで既に処理済み）
		if (data[tableId] && data[tableId].completedAt && data[tableId].completedAt !== lockTimestamp) {
			// この時点で既に他のプロセスが処理した場合は、上記のチェックで既に処理済みのはず
			// 念のため、エラーをログに記録
			console.error(`[麻雀] 予期しない状態: tableId=${tableId}, lockTimestamp=${lockTimestamp}, existingCompletedAt=${data[tableId].completedAt}`);
		}
		data[tableId] = matchRecord;
		delete data[tableId].processing; // 処理中フラグを削除
		
		// ユーザーごとの累計獲得賞金・負けた金額を更新
		if (!data.stats) {
			data.stats = {};
		}
		for (let i = 0; i < allPlayers.length; i++) {
			const playerId = allPlayers[i];
			const romecoinChange = results[i].romecoinChange;
			
			if (!data.stats[playerId]) {
				data.stats[playerId] = {
					totalWinnings: 0,
					totalLosses: 0,
					gamesPlayed: 0,
					gamesWon: 0,
				};
			}
			
			data.stats[playerId].gamesPlayed++;
			if (romecoinChange > 0) {
				data.stats[playerId].totalWinnings += romecoinChange;
				data.stats[playerId].gamesWon++;
			} else if (romecoinChange < 0) {
				data.stats[playerId].totalLosses += Math.abs(romecoinChange);
			}
		}
		
		saveMahjongData(data);

		// 結果を表示
		const resultEmbed = new EmbedBuilder()
			.setTitle('🀄 試合結果')
			.setDescription(
				`**部屋主:** <@${table.host}>\n**レート:** ${table.rate}ロメコイン/点\n**ゲームタイプ:** ${table.gameType}\n\n**結果:**\n${results
					.map(
						(r, i) =>
							`${i + 1}. <@${r.player}>: ${r.score}点 (${r.diff > 0 ? '+' : ''}${r.diff}点) → ${r.romecoinChange > 0 ? '+' : ''}${ROMECOIN_EMOJI}${r.romecoinChange.toLocaleString()} (残高: ${ROMECOIN_EMOJI}${r.newBalance.toLocaleString()})`
					)
					.join('\n')}`
			)
			.setColor(0x00ff00)
			.setTimestamp();

		if (deferred) {
			await interaction.editReply({ embeds: [resultEmbed] });
		} else {
			await interaction.reply({ embeds: [resultEmbed] });
		}

		// アクティブテーブルから削除
		activeTables.delete(tableId);
	} catch (error) {
		console.error('[麻雀] 結果処理エラー:', error);
		
		// エラーが発生した場合、ロックを解除（ロックが設定されていた場合）
		try {
			const tableId = interaction.options?.getString('table_id');
			if (tableId && lockTimestamp !== null) {
				const dataUnlock = loadMahjongData();
				if (dataUnlock[tableId] && dataUnlock[tableId].processing) {
					// processingフラグがあるが、completedAtが設定されていない場合はロックを解除
					// completedAtが設定されている場合は、他のプロセスが既に処理した可能性がある
					if (!dataUnlock[tableId].completedAt || dataUnlock[tableId].completedAt === lockTimestamp) {
						delete dataUnlock[tableId].completedAt;
						delete dataUnlock[tableId].processing;
						saveMahjongData(dataUnlock);
						console.log(`[麻雀] エラー発生によりロック解除: tableId=${tableId}`);
					}
				}
			}
		} catch (unlockError) {
			console.error('[麻雀] ロック解除エラー:', unlockError);
		}
		
		// エラーレスポンスを送信
		if (deferred) {
			await interaction.editReply({ content: `❌ エラー: ${error.message}` }).catch(() => {});
		} else if (!interaction.replied && !interaction.deferred) {
			try {
				await interaction.reply({
					content: `❌ エラー: ${error.message}`,
					flags: [MessageFlags.Ephemeral],
				});
			} catch (e) {
				// エラーを無視（Unknown interactionエラーなど）
				if (e.code !== 10062 && e.code !== 40060) {
					console.error('[麻雀] エラーレスポンス送信エラー:', e);
				}
			}
		}
	}
}

async function handleEdit(interaction, client) {
	// 処理に時間がかかるため、先にdeferReplyを呼び出す
	let deferred = false;
	try {
		if (!interaction.deferred && !interaction.replied) {
			await interaction.deferReply({ ephemeral: false });
			deferred = true;
		}
	} catch (e) {
		if (e.code !== 10062 && e.code !== 40060) {
			console.error('[麻雀] deferReplyエラー:', e);
		}
	}

	try {
		const tableId = interaction.options.getString('table_id');
		const hostScore = interaction.options.getInteger('player1_score');
		const player1Score = interaction.options.getInteger('player2_score');
		const player2Score = interaction.options.getInteger('player3_score');
		const player3Score = interaction.options.getInteger('player4_score');

		// データベースから読み込む
		const data = loadMahjongData();
		const table = data[tableId];

		if (!table) {
			if (deferred) {
				return interaction.editReply({
					content: 'テーブルが見つかりませんでした。',
				});
			}
			return interaction.reply({
				content: 'テーブルが見つかりませんでした。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 部屋主または管理者のみが記録を修正可能
		const isHost = interaction.user.id === table.host;
		let isAdmin = false;
		if (interaction.member) {
			try {
				isAdmin = await checkAdmin(interaction.member);
			} catch (e) {
				console.error('[麻雀] 管理者権限チェックエラー:', e);
			}
		}
		
		if (!isHost && !isAdmin) {
			if (deferred) {
				return interaction.editReply({
					content: '部屋主または管理者のみが記録を修正できます。',
				});
			}
			return interaction.reply({
				content: '部屋主または管理者のみが記録を修正できます。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// allPlayersを構築（部屋主の重複を除去）
		// 既存データでtable.playersに部屋主が含まれている可能性があるため、重複を除去
		const playersWithoutHost = table.players.filter((p) => p !== table.host);
		const allPlayers = [table.host, ...playersWithoutHost];
		
		const scores = [hostScore, player1Score, player2Score];
		if (table.gameType === '四麻') {
			if (player3Score === null || player3Score === undefined) {
				if (deferred) {
					return interaction.editReply({
						content: '四麻の場合は4人全員の点数を入力してください。',
					});
				}
				return interaction.reply({
					content: '四麻の場合は4人全員の点数を入力してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
			scores.push(player3Score);
		}
		
		// allPlayersとscoresの長さが一致するか確認
		if (allPlayers.length !== scores.length) {
			if (deferred) {
				return interaction.editReply({
					content: `プレイヤー数と点数数の不一致: プレイヤー${allPlayers.length}人、点数${scores.length}個`,
				});
			}
			return interaction.reply({
				content: `プレイヤー数と点数数の不一致: プレイヤー${allPlayers.length}人、点数${scores.length}個`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 点数バリデーション
		if (scores.some((s) => s === null || s === undefined)) {
			if (deferred) {
				return interaction.editReply({
					content: 'すべてのプレイヤーの点数を入力してください。',
				});
			}
			return interaction.reply({
				content: 'すべてのプレイヤーの点数を入力してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 点数整合性チェック（三麻: 合計105000点、四麻: 合計100000点）
		const expectedTotal = table.gameType === '四麻' ? 100000 : 105000;
		const actualTotal = scores.reduce((sum, score) => sum + score, 0);
		if (Math.abs(actualTotal - expectedTotal) > 1) {
			if (deferred) {
				return interaction.editReply({
					content: `点数の合計が正しくありません。${table.gameType === '四麻' ? '四麻' : '三麻'}の合計は${expectedTotal.toLocaleString()}点である必要があります。\n現在の合計: ${actualTotal.toLocaleString()}点`,
				});
			}
			return interaction.reply({
				content: `点数の合計が正しくありません。${table.gameType === '四麻' ? '四麻' : '三麻'}の合計は${expectedTotal.toLocaleString()}点である必要があります。\n現在の合計: ${actualTotal.toLocaleString()}点`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 基準点で計算（三麻: 35000点、四麻: 25000点）
		const BASE_SCORE = table.gameType === '四麻' ? 25000 : 35000;

		// 旧記録のロメコイン変更を元に戻す（既に結果が入力されている場合のみ）
		if (table.completedAt && table.scoreDiffs && table.scoreDiffs.length > 0) {
			const oldScoreDiffs = table.scoreDiffs;
			for (let i = 0; i < allPlayers.length; i++) {
				const playerId = allPlayers[i];
				const oldDiff = oldScoreDiffs[i] || 0;
				const oldRomecoinChange = Math.round(oldDiff * table.rate);

				try {
				// 旧変更を元に戻す
				const currentBalance = await require('./romecoin').getRomecoin(playerId);
				const revertedBalance = currentBalance - oldRomecoinChange;

					await updateRomecoin(
						playerId,
						(current) => revertedBalance,
						{
							log: true,
							client: client,
							reason: `賭け麻雀記録修正（元に戻す）: ${table.scores[i]}点`,
							useDeposit: oldRomecoinChange > 0, // 元に戻す際に減額する場合（oldRomecoinChangeが正の値の場合、元に戻すと減額）は預金から自動引き出し
							metadata: {
								commandName: 'mahjong_edit',
								targetUserId: playerId,
							},
						}
					);
				} catch (e) {
					console.error(`[麻雀] ロメコイン元に戻しエラー (playerId: ${playerId}):`, e);
					// エラーが発生しても処理を続行
				}
			}
		}

		// 新記録でロメコイン計算と更新
		const scoreDiffs = scores.map((score) => score - BASE_SCORE);

		const results = [];
		for (let i = 0; i < allPlayers.length; i++) {
			const playerId = allPlayers[i];
			const diff = scoreDiffs[i];
			const romecoinChange = Math.round(diff * table.rate);

			try {
				const currentBalance = await require('./romecoin').getRomecoin(playerId);
				const newBalance = currentBalance + romecoinChange;

				await updateRomecoin(
					playerId,
					(current) => newBalance,
					{
						log: true,
						client: client,
						reason: `賭け麻雀記録修正: ${scores[i]}点`,
						useDeposit: romecoinChange < 0, // 減額の場合のみ預金から自動引き出し
						metadata: {
							commandName: 'mahjong_edit',
							targetUserId: playerId,
						},
					}
				);

				results.push({
					player: playerId,
					score: scores[i],
					diff: diff,
					romecoinChange: romecoinChange,
					newBalance: newBalance,
				});
			} catch (e) {
				console.error(`[麻雀] ロメコイン更新エラー (playerId: ${playerId}):`, e);
				// エラーが発生した場合でも結果に追加（エラー表示用）
				results.push({
					player: playerId,
					score: scores[i],
					diff: diff,
					romecoinChange: romecoinChange,
					newBalance: 'エラー',
					error: e.message,
				});
			}
		}

		// 記録を更新
		table.scores = scores;
		table.scoreDiffs = scoreDiffs;
		table.romecoinChanges = results.map((r) => r.romecoinChange);
		table.editedAt = Date.now();
		table.editedBy = interaction.user.id;

		data[tableId] = table;
		
		// ユーザーごとの累計獲得賞金・負けた金額を更新（修正時は旧記録を差し引いて新記録を追加）
		if (!data.stats) {
			data.stats = {};
		}
		
		// 旧記録の統計を差し引く
		if (table.romecoinChanges && table.romecoinChanges.length > 0) {
			for (let i = 0; i < allPlayers.length; i++) {
				const playerId = allPlayers[i];
				const oldRomecoinChange = table.romecoinChanges[i] || 0;
				
				if (!data.stats[playerId]) {
					data.stats[playerId] = {
						totalWinnings: 0,
						totalLosses: 0,
						gamesPlayed: 0,
						gamesWon: 0,
					};
				}
				
				// 旧記録を差し引く
				if (oldRomecoinChange > 0) {
					data.stats[playerId].totalWinnings = Math.max(0, data.stats[playerId].totalWinnings - oldRomecoinChange);
					data.stats[playerId].gamesWon = Math.max(0, data.stats[playerId].gamesWon - 1);
				} else if (oldRomecoinChange < 0) {
					data.stats[playerId].totalLosses = Math.max(0, data.stats[playerId].totalLosses - Math.abs(oldRomecoinChange));
				}
				data.stats[playerId].gamesPlayed = Math.max(0, data.stats[playerId].gamesPlayed - 1);
			}
		}
		
		// 新記録の統計を追加
		for (let i = 0; i < allPlayers.length; i++) {
			const playerId = allPlayers[i];
			const romecoinChange = results[i].romecoinChange;
			
			if (!data.stats[playerId]) {
				data.stats[playerId] = {
					totalWinnings: 0,
					totalLosses: 0,
					gamesPlayed: 0,
					gamesWon: 0,
				};
			}
			
			data.stats[playerId].gamesPlayed++;
			if (romecoinChange > 0) {
				data.stats[playerId].totalWinnings += romecoinChange;
				data.stats[playerId].gamesWon++;
			} else if (romecoinChange < 0) {
				data.stats[playerId].totalLosses += Math.abs(romecoinChange);
			}
		}
		
		saveMahjongData(data);

		// 結果を表示
		const resultEmbed = new EmbedBuilder()
			.setTitle('🀄 試合記録修正完了')
			.setDescription(
				`**部屋主:** <@${table.host}>\n**レート:** ${table.rate}ロメコイン/点\n**ゲームタイプ:** ${table.gameType}\n\n**修正後の結果:**\n${results
					.map(
						(r, i) =>
							`${i + 1}. <@${r.player}>: ${r.score}点 (${r.diff > 0 ? '+' : ''}${r.diff}点) → ${r.romecoinChange > 0 ? '+' : ''}${ROMECOIN_EMOJI}${r.romecoinChange.toLocaleString()} (残高: ${ROMECOIN_EMOJI}${r.newBalance.toLocaleString()})`
					)
					.join('\n')}\n\n✅ **記録が修正されました。**`
			)
			.setColor(0x00ff00)
			.setTimestamp();

		if (deferred) {
			await interaction.editReply({ embeds: [resultEmbed] });
		} else {
			await interaction.reply({ embeds: [resultEmbed] });
		}
	} catch (error) {
		console.error('[麻雀] 記録修正エラー:', error);
		try {
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({
					content: 'エラーが発生しました。',
				});
			} else {
				await interaction.reply({
					content: 'エラーが発生しました。',
					flags: [MessageFlags.Ephemeral],
				});
			}
		} catch (e) {
			// インタラクションがタイムアウトしている場合は無視
			if (e.code !== 10062 && e.code !== 40060) {
				console.error('[麻雀] エラーレスポンス送信エラー:', e);
			}
		}
	}
}

async function handleCancel(interaction, client) {
	try {
		const tableId = interaction.customId.replace('mahjong_cancel_', '');
		const table = activeTables.get(tableId);

		if (!table) {
			return interaction.reply({
				content: 'このテーブルは既に終了しています。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (interaction.user.id !== table.host) {
			return interaction.reply({
				content: '部屋主のみが開催を中止できます。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (table.status !== 'waiting') {
			return interaction.reply({
				content: 'このテーブルは既に開始されています。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// テーブルを削除
		activeTables.delete(tableId);

		// 同意済みプレイヤー情報を取得
		const agreedPlayersList = table.agreedPlayers.length > 0 
			? `\n\n**同意済み:** ${table.agreedPlayers.map((p) => `<@${p}>`).join(', ')}`
			: '';

		const embed = new EmbedBuilder()
			.setTitle('❌ 開催中止')
			.setDescription(`部屋主により、このテーブルは中止されました。${agreedPlayersList}`)
			.setColor(0xff0000)
			.setTimestamp();

		try {
			await interaction.update({ embeds: [embed], components: [] });
		} catch (e) {
			// インタラクションがタイムアウトしている場合はメッセージを編集
			if (e.code === 10062 || e.code === 40060) {
				try {
					const message = await interaction.message.edit({ embeds: [embed], components: [] });
				} catch (editError) {
					console.error('[麻雀] キャンセルメッセージ編集エラー:', editError);
				}
			} else {
				throw e;
			}
		}
	} catch (error) {
		console.error('[麻雀] キャンセル処理エラー:', error);
		if (error.code !== 10062 && error.code !== 40060) {
			try {
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: 'エラーが発生しました。',
						flags: [MessageFlags.Ephemeral],
					});
				}
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

async function handleRanking(interaction, client) {
	try {
		const data = loadMahjongData();
		
		// 統計を再計算（既存の試合記録から）
		recalculateStats(data);
		saveMahjongData(data);
		
		if (!data.stats || Object.keys(data.stats).length === 0) {
			return interaction.reply({
				content: 'ランキングデータがありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 獲得賞金ランキング
		const winningsRanking = Object.entries(data.stats)
			.map(([userId, stats]) => ({
				userId,
				totalWinnings: stats.totalWinnings || 0,
				gamesWon: stats.gamesWon || 0,
				gamesPlayed: stats.gamesPlayed || 0,
			}))
			.filter((entry) => entry.totalWinnings > 0)
			.sort((a, b) => b.totalWinnings - a.totalWinnings)
			.slice(0, 10);

		// 負けた金額ランキング
		const lossesRanking = Object.entries(data.stats)
			.map(([userId, stats]) => ({
				userId,
				totalLosses: stats.totalLosses || 0,
				gamesPlayed: stats.gamesPlayed || 0,
			}))
			.filter((entry) => entry.totalLosses > 0)
			.sort((a, b) => b.totalLosses - a.totalLosses)
			.slice(0, 10);

		const embed = new EmbedBuilder()
			.setTitle('🀄 賭け麻雀ランキング')
			.setColor(0x00ff00)
			.setTimestamp();

		// 獲得賞金ランキング
		if (winningsRanking.length > 0) {
			const winningsText = winningsRanking
				.map((entry, index) => {
					const user = client.users.cache.get(entry.userId);
					const userName = user ? user.tag : `<@${entry.userId}>`;
					const winRate = entry.gamesPlayed > 0 
						? ((entry.gamesWon / entry.gamesPlayed) * 100).toFixed(1)
						: '0.0';
					return `${index + 1}. **${userName}**\n   ${ROMECOIN_EMOJI}${entry.totalWinnings.toLocaleString()} (${entry.gamesWon}勝/${entry.gamesPlayed}戦、勝率${winRate}%)`;
				})
				.join('\n\n');
			embed.addFields({
				name: '💰 獲得賞金ランキング',
				value: winningsText || 'データなし',
				inline: false,
			});
		} else {
			embed.addFields({
				name: '💰 獲得賞金ランキング',
				value: 'データなし',
				inline: false,
			});
		}

		// 負けた金額ランキング
		if (lossesRanking.length > 0) {
			const lossesText = lossesRanking
				.map((entry, index) => {
					const user = client.users.cache.get(entry.userId);
					const userName = user ? user.tag : `<@${entry.userId}>`;
					return `${index + 1}. **${userName}**\n   ${ROMECOIN_EMOJI}${entry.totalLosses.toLocaleString()} (${entry.gamesPlayed}戦)`;
				})
				.join('\n\n');
			embed.addFields({
				name: '💸 負けた金額ランキング',
				value: lossesText || 'データなし',
				inline: false,
			});
		} else {
			embed.addFields({
				name: '💸 負けた金額ランキング',
				value: 'データなし',
				inline: false,
			});
		}

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[麻雀] ランキングエラー:', error);
		if (!interaction.replied && !interaction.deferred) {
			try {
				await interaction.reply({
					content: 'エラーが発生しました。',
					flags: [MessageFlags.Ephemeral],
				});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

module.exports = {
	createTable,
	handleAgreement,
	handleResult,
	handleEdit,
	handleCancel,
	loadMahjongData,
	handleRanking,
};

