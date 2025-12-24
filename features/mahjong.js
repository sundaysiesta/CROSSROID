const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getData, updateData } = require('./dataAccess');
const { updateRomecoin } = require('./romecoin');
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';

const MAHJONG_DATA_FILE = path.join(__dirname, '..', 'mahjong_data.json');
const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5分

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

// 麻雀データ取得
let mahjong_data = loadMahjongData();

// 進行中のテーブル管理
const activeTables = new Map(); // tableId -> { host, players, rate, gameType, message, agreedPlayers, createdAt }

async function createTable(interaction, client) {
	try {
		const host = interaction.user;
		const rate = interaction.options.getInteger('rate');
		const player1 = interaction.options.getUser('player1');
		const player2 = interaction.options.getUser('player2');
		const player3 = interaction.options.getUser('player3');

		// バリデーション
		if (rate < 1) {
			return interaction.reply({
				content: 'レートは1以上で指定してください。',
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

		const gameType = player3 ? '四麻' : 'サンマ';
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
			return new ButtonBuilder()
				.setCustomId(`mahjong_agree_${tableId}_${player.id}`)
				.setLabel(`${player.displayName}が同意`)
				.setStyle(ButtonStyle.Success)
				.setEmoji('✅');
		});

		const row = new ActionRowBuilder().addComponents(buttons);

		const embed = new EmbedBuilder()
			.setTitle('🀄 賭け麻雀テーブル作成')
			.setDescription(
				`**部屋主:** ${host}\n**レート:** ${rate}ロメコイン/点\n**ゲームタイプ:** ${gameType}\n\n**参加メンバー:**\n1. ${host} (部屋主)\n${players.map((p, i) => `${i + 2}. ${p}`).join('\n')}\n\n**同意待ち:** ${players.map((p) => p).join(', ')}`
			)
			.setColor(0x00ff00)
			.setTimestamp();

		const reply = await interaction.reply({
			embeds: [embed],
			components: [row],
		});

		table.message = reply.id;
		activeTables.set(tableId, table);

		// タイムアウト処理
		setTimeout(() => {
			const currentTable = activeTables.get(tableId);
			if (currentTable && currentTable.status === 'waiting') {
				const remainingPlayers = players.filter(
					(p) => !currentTable.agreedPlayers.includes(p.id)
				);
				if (remainingPlayers.length > 0) {
					const embed = new EmbedBuilder()
						.setTitle('⏰ タイムアウト')
						.setDescription(
							`以下のメンバーの同意が得られなかったため、テーブルはキャンセルされました。\n${remainingPlayers.map((p) => `<@${p.id}>`).join(', ')}`
						)
						.setColor(0xff0000)
						.setTimestamp();

					interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
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
		const [, , tableId, playerId] = interaction.customId.split('_');
		const table = activeTables.get(tableId);

		if (!table) {
			return interaction.reply({
				content: 'このテーブルは既に終了しています。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (table.status !== 'waiting') {
			return interaction.reply({
				content: 'このテーブルは既に開始されています。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (interaction.user.id !== playerId) {
			return interaction.reply({
				content: 'あなたはこのテーブルの参加メンバーではありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (table.agreedPlayers.includes(playerId)) {
			return interaction.reply({
				content: 'あなたは既に同意しています。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		table.agreedPlayers.push(playerId);

		const allPlayers = [table.host, ...table.players];
		const remainingPlayers = table.players.filter((p) => !table.agreedPlayers.includes(p));

		if (remainingPlayers.length === 0) {
			// 全員同意したので試合開始
			table.status = 'in_progress';
			table.startedAt = Date.now();

			const embed = new EmbedBuilder()
				.setTitle('🀄 試合開始')
				.setDescription(
					`**部屋主:** <@${table.host}>\n**レート:** ${table.rate}ロメコイン/点\n**ゲームタイプ:** ${table.gameType}\n\n**参加メンバー:**\n${allPlayers.map((p, i) => `${i + 1}. <@${p}>`).join('\n')}\n\n✅ **全員の同意が得られました。試合を開始してください。**\n\n試合終了後、部屋主は以下のコマンドで点数を入力してください：\n\`/mahjong_result table_id:${tableId} player1_score:部屋主の点数 player2_score:${allPlayers[1] ? 'player1の点数' : ''} player3_score:${allPlayers[2] ? 'player2の点数' : ''}${table.gameType === '四麻' ? ' player4_score:player3の点数' : ''}\``
				)
				.setColor(0x00ff00)
				.setTimestamp();

			await interaction.update({ embeds: [embed], components: [] });
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
			const buttonPromises = table.players.map(async (player) => {
				const isAgreed = table.agreedPlayers.includes(player.id);
				const user = await client.users.fetch(player).catch(() => null);
				const displayName = user ? user.displayName : `ユーザー${player}`;
				return new ButtonBuilder()
					.setCustomId(`mahjong_agree_${tableId}_${player.id}`)
					.setLabel(`${displayName}が同意`)
					.setStyle(isAgreed ? ButtonStyle.Secondary : ButtonStyle.Success)
					.setEmoji('✅')
					.setDisabled(isAgreed);
			});

			const buttons = await Promise.all(buttonPromises);
			const row = new ActionRowBuilder().addComponents(buttons);

			await interaction.update({ embeds: [embed], components: [row] });
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
				return interaction.reply({
					content: 'テーブルが見つかりませんでした。',
					flags: [MessageFlags.Ephemeral],
				});
			}
			// 保存されたテーブルを使用
			table = savedTable;
		}

		if (interaction.user.id !== table.host) {
			return interaction.reply({
				content: '部屋主のみが点数を入力できます。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const allPlayers = [table.host, ...table.players];
		const scores = [hostScore, player1Score, player2Score];
		if (table.gameType === '四麻') {
			if (player3Score === null || player3Score === undefined) {
				return interaction.reply({
					content: '四麻の場合は4人全員の点数を入力してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
			scores.push(player3Score);
		}

		// 点数バリデーション
		if (scores.some((s) => s === null || s === undefined)) {
			return interaction.reply({
				content: 'すべてのプレイヤーの点数を入力してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 25000点基準で計算
		const BASE_SCORE = 25000;
		const scoreDiffs = scores.map((score) => score - BASE_SCORE);

		// ロメコイン計算と更新
		const results = [];
		for (let i = 0; i < allPlayers.length; i++) {
			const playerId = allPlayers[i];
			const diff = scoreDiffs[i];
			const romecoinChange = diff * table.rate;

			const currentBalance = await require('./romecoin').getRomecoin(playerId);
			const newBalance = Math.max(0, currentBalance + romecoinChange);

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

		// 試合記録を保存
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
			completedAt: Date.now(),
		};

		const data = loadMahjongData();
		data[tableId] = matchRecord;
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

		await interaction.reply({ embeds: [resultEmbed] });

		// アクティブテーブルから削除
		activeTables.delete(tableId);
	} catch (error) {
		console.error('[麻雀] 結果処理エラー:', error);
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

async function handleEdit(interaction, client) {
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
			return interaction.reply({
				content: 'テーブルが見つかりませんでした。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (interaction.user.id !== table.host) {
			return interaction.reply({
				content: '部屋主のみが記録を修正できます。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const allPlayers = [table.host, ...table.players];
		const scores = [hostScore, player1Score, player2Score];
		if (table.gameType === '四麻') {
			if (player3Score === null || player3Score === undefined) {
				return interaction.reply({
					content: '四麻の場合は4人全員の点数を入力してください。',
					flags: [MessageFlags.Ephemeral],
				});
			}
			scores.push(player3Score);
		}

		// 旧記録のロメコイン変更を元に戻す
		const oldScoreDiffs = table.scoreDiffs || [];
		for (let i = 0; i < allPlayers.length; i++) {
			const playerId = allPlayers[i];
			const oldDiff = oldScoreDiffs[i] || 0;
			const oldRomecoinChange = oldDiff * table.rate;

			// 旧変更を元に戻す
			const currentBalance = await require('./romecoin').getRomecoin(playerId);
			const revertedBalance = Math.max(0, currentBalance - oldRomecoinChange);

			await updateRomecoin(
				playerId,
				(current) => revertedBalance,
				{
					log: true,
					client: client,
					reason: `賭け麻雀記録修正（元に戻す）: ${table.scores[i]}点`,
					metadata: {
						commandName: 'mahjong_edit',
						targetUserId: playerId,
					},
				}
			);
		}

		// 新記録でロメコイン計算と更新
		const BASE_SCORE = 25000;
		const scoreDiffs = scores.map((score) => score - BASE_SCORE);

		const results = [];
		for (let i = 0; i < allPlayers.length; i++) {
			const playerId = allPlayers[i];
			const diff = scoreDiffs[i];
			const romecoinChange = diff * table.rate;

			const currentBalance = await require('./romecoin').getRomecoin(playerId);
			const newBalance = Math.max(0, currentBalance + romecoinChange);

			await updateRomecoin(
				playerId,
				(current) => newBalance,
				{
					log: true,
					client: client,
					reason: `賭け麻雀記録修正: ${scores[i]}点`,
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
		}

		// 記録を更新
		table.scores = scores;
		table.scoreDiffs = scoreDiffs;
		table.romecoinChanges = results.map((r) => r.romecoinChange);
		table.editedAt = Date.now();
		table.editedBy = interaction.user.id;

		data[tableId] = table;
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

		await interaction.reply({ embeds: [resultEmbed] });
	} catch (error) {
		console.error('[麻雀] 記録修正エラー:', error);
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
	loadMahjongData,
};

