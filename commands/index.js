const {
	EmbedBuilder,
	PermissionFlagsBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	MessageFlags,
} = require('discord.js');
const { generateWacchoi, generateDailyUserId, getAnonymousName } = require('../utils');
const {
	ANONYMOUS_COOLDOWN_TIERS,
	BUMP_COOLDOWN_MS,
	RANDOM_MENTION_COOLDOWN_MS,
	MAIN_CHANNEL_ID,
	CURRENT_GENERATION_ROLE_ID,
	HIGHLIGHT_CHANNEL_ID,
	ELITE_ROLE_ID,
	ADMIN_ROLE_ID,
	TECHTEAM_ROLE_ID,
	OWNER_ROLE_ID,
	RADIATION_ROLE_ID,
	SHOP_LOG_VIEWER_ROLE_ID,
	SHOP_EMOJI_CREATOR_ROLE_ID,
} = require('../constants');
const fs = require('fs');
const path = require('path');
const { checkAdmin } = require('../utils');
const persistence = require('../features/persistence');
const { getData, updateData, migrateData, getDataWithPrefix, setDataWithPrefix } = require('../features/dataAccess');
const { getRomecoin, updateRomecoin } = require('../features/romecoin');
const { isUserInGame, setUserGame, clearUserGame } = require('../utils');
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';

// コマンドごとのクールダウン管理
const anonymousCooldowns = new Map();
const anonymousUsageCounts = new Map();
const bumpCooldowns = new Map();
const randomMentionCooldowns = new Map();
const shopBuyCooldowns = new Map(); // サーバー間クールダウン（30秒）
const processingCommands = new Set();

async function handleCommands(interaction, client) {
	if (interaction.isChatInputCommand()) {
		if (interaction.commandName === 'anonymous') {
			const commandKey = `anonymous_${interaction.user.id}_${interaction.id}`;
			if (processingCommands.has(commandKey))
				return interaction.reply({ content: '処理中です。', ephemeral: true });
			processingCommands.add(commandKey);

			const now = Date.now();
			const dateObj = new Date();
			const todayKey = `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, '0')}${String(
				dateObj.getDate()
			).padStart(2, '0')}`;

			let usageData = anonymousUsageCounts.get(interaction.user.id) || { count: 0, date: todayKey };
			if (usageData.date !== todayKey) usageData = { count: 0, date: todayKey };

			const currentCount = usageData.count + 1;
			let cooldownTime = ANONYMOUS_COOLDOWN_TIERS[0].time;
			for (const tier of ANONYMOUS_COOLDOWN_TIERS) {
				if (currentCount <= tier.limit) {
					cooldownTime = tier.time;
					break;
				}
			}

			if (interaction.member && interaction.member.roles.cache.has(ELITE_ROLE_ID)) {
				cooldownTime = Math.floor(cooldownTime / 2);
			}

			const lastUsed = anonymousCooldowns.get(interaction.user.id) || 0;
			const elapsed = now - lastUsed;

			if (elapsed < cooldownTime) {
				processingCommands.delete(commandKey);
				const remainSec = Math.ceil((cooldownTime - elapsed) / 1000);
				return interaction.reply({ content: `連投制限中です（残り${remainSec}秒）`, ephemeral: true });
			}

			const content = interaction.options.getString('内容');
			if (
				content.includes('\n') ||
				content.length > 256 ||
				content.includes('@everyone') ||
				content.includes('@here') ||
				content.includes('<@&')
			) {
				processingCommands.delete(commandKey);
				const errEmbed = new EmbedBuilder()
					.setColor(0xff0000)
					.setDescription('❌ エラー: 改行不可/256文字以内/メンション不可');
				return interaction.reply({ embeds: [errEmbed], ephemeral: true });
			}

			try {
				const wacchoi = generateWacchoi(interaction.user.id);
				const dailyId = generateDailyUserId(interaction.user.id);

				const uglyName = getAnonymousName(wacchoi.daily);
				const displayName = `${uglyName} ID:${dailyId} (ﾜｯﾁｮｲ ${wacchoi.full})`;
				const avatarURL = client.user.displayAvatarURL();

				const webhooks = await interaction.channel.fetchWebhooks();
				let webhook = webhooks.find((wh) => wh.name === 'CROSSROID Anonymous');
				if (!webhook)
					webhook = await interaction.channel.createWebhook({
						name: 'CROSSROID Anonymous',
						avatar: avatarURL,
					});

				await webhook.send({
					content: content
						.replace(/@everyone/g, '@\u200beveryone')
						.replace(/@here/g, '@\u200bhere')
						.replace(/<@&(\d+)>/g, '<@\u200b&$1>'),
					username: displayName,
					avatarURL: avatarURL,
					allowedMentions: { parse: [] },
				});

				anonymousCooldowns.set(interaction.user.id, Date.now());
				usageData.count++;
				anonymousUsageCounts.set(interaction.user.id, usageData);
				const successEmbed = new EmbedBuilder()
					.setColor(0x00ff00)
					.setDescription(`✅ 送信しました (本日${usageData.count}回目)`);
				await interaction.reply({ embeds: [successEmbed], ephemeral: true }).catch((err) => {
					if (err.code !== 10062) console.error('Silent Error:', err);
				});
			} catch (e) {
				console.error(e);
				if (!interaction.replied) await interaction.reply({ content: 'エラー', ephemeral: true });
			} finally {
				processingCommands.delete(commandKey);
			}
			return;
		}

		// Keep other non-admin commands (anonymous_resolve, bump, etc) briefly...
		if (interaction.commandName === 'bump') {
			const userId = interaction.user.id;
			const now = Date.now();
			const last = bumpCooldowns.get(userId) || 0;
			if (now - last < BUMP_COOLDOWN_MS)
				return interaction.reply({
					embeds: [new EmbedBuilder().setColor(0xffa500).setDescription('⏳ クールダウン中')],
					ephemeral: true,
				});
			bumpCooldowns.set(userId, now);
			await interaction.reply({
				embeds: [new EmbedBuilder().setColor(0x00ff00).setDescription('👊 Bumpしました')],
				ephemeral: true,
			});
			return;
		}

		if (interaction.commandName === 'random_mention') {
			const userId = interaction.user.id;
			const now = Date.now();
			if (now - (randomMentionCooldowns.get(userId) || 0) < RANDOM_MENTION_COOLDOWN_MS)
				return interaction.reply({
					embeds: [new EmbedBuilder().setColor(0xffa500).setDescription('⏳ Cooling down')],
					ephemeral: true,
				});
			randomMentionCooldowns.set(userId, now);
			const members = await interaction.guild.members.fetch();
			const random = members.filter((m) => !m.user.bot).random();
			if (random)
				interaction.reply({
					content: `${random}`,
					embeds: [
						new EmbedBuilder()
							.setColor(0x00ffff)
							.setDescription(`👋 Hello! You were randomly selected by ${interaction.user.username}!`),
					],
					allowedMentions: { users: [random.id] },
				});
			else interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription('❌ No members')] });
			return;
		}

		if (interaction.commandName === 'duel_ranking') {
			const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
			const notionManager = require('../features/notion');

			if (!fs.existsSync(DATA_FILE)) {
				return interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setTitle('📊 ランキング')
							.setDescription('データがまだありません。')
							.setColor(0x2f3136),
					],
					ephemeral: true,
				});
			}

			let duelData = {};
			try {
				duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
			} catch (e) {
				console.error(e);
				return interaction.reply({ content: 'データ読み込みエラー', ephemeral: true });
			}

			// Convert object to array & Sanitize
			const players = (
				await Promise.all(
					Object.entries(duelData).map(async ([key, data]) => {
						// データが無効な場合はスキップ
						if (!data || typeof data !== 'object') return null;

						// キーがNotion名かDiscord IDかを判定（数字のみならID、そうでなければNotion名）
						const isNotionName = !/^\d+$/.test(key);
						let discordId = key;

						if (isNotionName) {
							// Notion名からDiscord IDを取得
							discordId = (await notionManager.getDiscordId(key)) || key;
						}

						return {
							key,
							discordId,
							displayName: isNotionName ? key : null,
							wins: Number(data.wins) || 0,
							streak: Number(data.streak) || 0,
							losses: Number(data.losses) || 0,
							maxStreak: Number(data.maxStreak) || 0,
						};
					})
				)
			).filter((p) => p !== null); // nullを除外

			// Top Wins
			const topWins = [...players].sort((a, b) => b.wins - a.wins).slice(0, 5);
			// Top Streaks (Current)
			const topStreaks = [...players].sort((a, b) => b.streak - a.streak).slice(0, 5);
			// Top Losses
			const topLosses = [...players].sort((a, b) => b.losses - a.losses).slice(0, 5);

			const buildLeaderboard = (list, type) => {
				if (list.length === 0) return 'なし';
				return list
					.map((p, i) => {
						if (!p || !p.discordId) return ''; // nullチェック
						const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
						let val;
						if (type === 'wins') {
							val = `${p.wins}勝`;
						} else if (type === 'losses') {
							val = `${p.losses}敗`;
						} else {
							val = `${p.streak}連勝`;
						}
						const display = p.displayName ? `${p.displayName} (<@${p.discordId}>)` : `<@${p.discordId}>`;
						return `${medal} ${display} (**${val}**)`;
					})
					.filter((line) => line !== '')
					.join('\n'); // 空行を除外
			};

			const embed = new EmbedBuilder()
				.setTitle('🏆 決闘ランキング')
				.setColor(0xffd700)
				.addFields(
					{ name: '🔥 勝利数 Top 5', value: buildLeaderboard(topWins, 'wins'), inline: true },
					{ name: '💀 敗北数 Top 5', value: buildLeaderboard(topLosses, 'losses'), inline: true },
					{ name: '⚡ 現在の連勝記録 Top 5', value: buildLeaderboard(topStreaks, 'streak'), inline: true }
				)
				.setFooter({ text: `※ 通常決闘とロシアン・デスマッチの合算戦績です (登録者: ${players.length}人)` })
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
			return;
		}

		if (interaction.commandName === 'give') {
			const targetUser = interaction.options.getUser('user');
			const amount = interaction.options.getInteger('amount');

			// バリデーション
			if (!targetUser) {
				return interaction.reply({
					content: '❌ ユーザーを指定してください。',
					ephemeral: true,
				});
			}

			if (!amount || amount <= 0) {
				return interaction.reply({
					content: '❌ 有効な金額（1以上）を指定してください。',
					ephemeral: true,
				});
			}

			// 自分自身への譲渡を防ぐ
			if (targetUser.id === interaction.user.id) {
				return interaction.reply({
					content: '❌ 自分自身にロメコインを譲渡することはできません。',
					ephemeral: true,
				});
			}

			// Botへの譲渡を防ぐ
			if (targetUser.bot) {
				return interaction.reply({
					content: '❌ Botにロメコインを譲渡することはできません。',
					ephemeral: true,
				});
			}

			// 世代ロールチェック（giveを実行するユーザーに必須）
			const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
			const member = interaction.member;
			const hasGenerationRole =
				member.roles.cache.some((r) => romanRegex.test(r.name)) ||
				member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

			if (!hasGenerationRole) {
				return interaction.reply({
					content: '❌ ロメコインを譲渡するには世代ロールが必要です。',
					ephemeral: true,
				});
			}

			// 現在の残高を確認
			const senderId = interaction.user.id;
			const currentBalance = await getRomecoin(senderId);

			if (currentBalance < amount) {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('ロメコインが不足しています')
					.addFields(
						{ name: '現在の所持ロメコイン', value: `${ROMECOIN_EMOJI}${currentBalance}`, inline: true },
						{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${amount}`, inline: true }
					)
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
			}

			// ロメコインを譲渡
			try {
				// 送信者のロメコインを減らす（ログ付き）
				await updateRomecoin(
					senderId,
					(current) => Math.round((current || 0) - amount),
					{
						log: true,
						client: interaction.client,
						reason: `giveコマンド: ${targetUser.tag} への譲渡`,
						metadata: {
							executorId: interaction.user.id,
							targetUserId: targetUser.id,
							commandName: 'give',
						},
					}
				);
				// 受信者のロメコインを増やす（ログ付き）
				await updateRomecoin(
					targetUser.id,
					(current) => Math.round((current || 0) + amount),
					{
						log: true,
						client: interaction.client,
						reason: `giveコマンド: ${interaction.user.tag} からの譲渡`,
						metadata: {
							executorId: interaction.user.id,
							targetUserId: senderId,
							commandName: 'give',
						},
					}
				);

				// 成功メッセージ
				const senderNewBalance = await getRomecoin(senderId);
				const receiverNewBalance = await getRomecoin(targetUser.id);

				const successEmbed = new EmbedBuilder()
					.setTitle('✅ ロメコイン譲渡成功')
					.setDescription(`${interaction.user} が ${targetUser} に ${ROMECOIN_EMOJI}${amount} を譲渡しました`)
					.addFields(
						{
							name: `${interaction.user.username}の残高`,
							value: `${ROMECOIN_EMOJI}${senderNewBalance}`,
							inline: true,
						},
						{
							name: `${targetUser.username}の残高`,
							value: `${ROMECOIN_EMOJI}${receiverNewBalance}`,
							inline: true,
						}
					)
					.setColor(0x00ff00)
					.setTimestamp();

				await interaction.reply({ embeds: [successEmbed] });
			} catch (error) {
				console.error('[Give] エラー:', error);
				return interaction.reply({
					content: '❌ ロメコインの譲渡中にエラーが発生しました。',
					ephemeral: true,
				});
			}
			return;
		}

		if (interaction.commandName === 'janken_ranking') {
			const DATA_FILE = path.join(__dirname, '..', 'janken_data.json');
			const notionManager = require('../features/notion');

			if (!fs.existsSync(DATA_FILE)) {
				return interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setTitle('📊 ランキング')
							.setDescription('データがまだありません。')
							.setColor(0x2f3136),
					],
					ephemeral: true,
				});
			}

			let jankenData = {};
			try {
				jankenData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
			} catch (e) {
				console.error(e);
				return interaction.reply({ content: 'データ読み込みエラー', ephemeral: true });
			}

			// Convert object to array & Sanitize
			const players = (
				await Promise.all(
					Object.entries(jankenData).map(async ([key, data]) => {
						// データが無効な場合はスキップ
						if (!data || typeof data !== 'object') return null;

						// キーがNotion名かDiscord IDかを判定（数字のみならID、そうでなければNotion名）
						const isNotionName = !/^\d+$/.test(key);
						let discordId = key;

						if (isNotionName) {
							// Notion名からDiscord IDを取得
							discordId = (await notionManager.getDiscordId(key)) || key;
						}

						return {
							key,
							discordId,
							displayName: isNotionName ? key : null,
							wins: Number(data.wins) || 0,
							streak: Number(data.streak) || 0,
							losses: Number(data.losses) || 0,
							maxStreak: Number(data.maxStreak) || 0,
						};
					})
				)
			).filter((p) => p !== null); // nullを除外

			// Top Wins
			const topWins = [...players].sort((a, b) => b.wins - a.wins).slice(0, 5);
			// Top Streaks (Current)
			const topStreaks = [...players].sort((a, b) => b.streak - a.streak).slice(0, 5);
			// Top Losses
			const topLosses = [...players].sort((a, b) => b.losses - a.losses).slice(0, 5);

			const buildLeaderboard = (list, type) => {
				if (list.length === 0) return 'なし';
				return list
					.map((p, i) => {
						if (!p || !p.discordId) return ''; // nullチェック
						const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
						let val;
						if (type === 'wins') {
							val = `${p.wins}勝`;
						} else if (type === 'losses') {
							val = `${p.losses}敗`;
						} else {
							val = `${p.streak}連勝`;
						}
						const display = p.displayName ? `${p.displayName} (<@${p.discordId}>)` : `<@${p.discordId}>`;
						return `${medal} ${display} (**${val}**)`;
					})
					.filter((line) => line !== '')
					.join('\n'); // 空行を除外
			};

			const embed = new EmbedBuilder()
				.setTitle('✂️ じゃんけんランキング')
				.setColor(0xffa500)
				.addFields(
					{ name: '🔥 勝利数 Top 5', value: buildLeaderboard(topWins, 'wins'), inline: true },
					{ name: '💀 敗北数 Top 5', value: buildLeaderboard(topLosses, 'losses'), inline: true },
					{ name: '⚡ 現在の連勝記録 Top 5', value: buildLeaderboard(topStreaks, 'streak'), inline: true }
				)
				.setFooter({ text: `※ じゃんけんの戦績です (登録者: ${players.length}人)` })
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
			return;
		}

		if (interaction.commandName === 'duel_russian') {
			const userId = interaction.user.id;

			// 重複実行チェック（最初にチェック）
			if (isUserInGame(userId)) {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription(
						'あなたは現在他のゲーム（duel/duel_russian/janken）を実行中です。同時に実行できるのは1つだけです。'
					)
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
			}

			// 即座にロックをかける（重複対戦を防ぐ）
			const tempProgressId = `temp_russian_${userId}_${Date.now()}`;
			setUserGame(userId, 'duel_russian', tempProgressId);

			try {
				// 被爆ロールチェック：被爆ロールがついている人は対戦コマンドを実行できない
				if (interaction.member.roles.cache.has(RADIATION_ROLE_ID)) {
					clearUserGame(userId);
					const errorEmbed = new EmbedBuilder()
						.setTitle('❌ エラー')
						.setDescription('被爆ロールがついているため、対戦コマンドを実行できません。')
						.setColor(0xff0000);
					return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
				}

			const opponentUser = interaction.options.getUser('対戦相手');
			const bet = interaction.options.getInteger('bet') || 100; // デフォルト100
			const isOpenChallenge = !opponentUser; // 相手が指定されていない場合は誰でも挑戦可能

				// ロメコインチェック
				const userRomecoin = await getRomecoin(userId);
				if (userRomecoin < bet) {
					clearUserGame(userId);
					const errorEmbed = new EmbedBuilder()
						.setTitle('❌ エラー')
						.setDescription('ロメコインが不足しています')
						.addFields(
							{ name: '現在の所持ロメコイン', value: `${ROMECOIN_EMOJI}${userRomecoin}`, inline: true },
							{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
						)
						.setColor(0xff0000);
					return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
				}

				// 相手が指定されている場合のバリデーション
				if (opponentUser) {
					if (opponentUser.id === userId || opponentUser.bot) {
						clearUserGame(userId);
						return interaction.reply({ content: '自分自身やBotとは対戦できません。', ephemeral: true });
					}

					// 対戦相手のロメコインチェック
					const opponentRomecoin = await getRomecoin(opponentUser.id);
					if (opponentRomecoin < bet) {
						clearUserGame(userId);
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('対戦相手のロメコインが不足しています')
							.addFields(
								{
									name: `${opponentUser}の現在の所持ロメコイン`,
									value: `${ROMECOIN_EMOJI}${opponentRomecoin}`,
									inline: true,
								},
								{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
							)
							.setColor(0xff0000);
						return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
					}
				}

				// Cooldown Check
				const COOLDOWN_FILE = path.join(__dirname, '..', 'custom_cooldowns.json');
				let cooldowns = {};
				if (fs.existsSync(COOLDOWN_FILE)) {
					try {
						cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
					} catch (e) {}
				}

				// データ引き継ぎ（ID → Notion名）
				await migrateData(userId, cooldowns, 'battle_');

				const now = Date.now();
				const lastUsed = await getDataWithPrefix(userId, cooldowns, 'battle_', 0);
				const CD_DURATION = 1 * 24 * 60 * 60 * 1000; // 1 Day Cooldown for Russian

				if (now - lastUsed < CD_DURATION) {
					clearUserGame(userId);
					const h = Math.ceil((CD_DURATION - (now - lastUsed)) / (60 * 60 * 1000));
					return interaction.reply({ content: `🔫 整備中です。あと ${h}時間 お待ちください。`, ephemeral: true });
				}

			// UI
			const buttonCustomId = isOpenChallenge
				? `russian_accept_${userId}`
				: `russian_accept_${userId}_${opponentUser.id}`;

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(buttonCustomId)
					.setLabel('受けて立つ')
					.setStyle(ButtonStyle.Danger)
					.setEmoji('🔫')
			);

			const embed = new EmbedBuilder()
				.setTitle('☠️ ロシアン・デスマッチ')
				.setDescription(
					isOpenChallenge
						? `${interaction.user} が誰でも挑戦可能なロシアンルーレットを開始しました。\n\n**誰でも「受けて立つ」ボタンを押して挑戦できます！**`
						: `${opponentUser}\n${interaction.user} から死のゲームへの招待です。`
				)
				.addFields(
					{ name: 'ルール', value: '1発の実弾が入ったリボルバーを交互に引き金を引く', inline: false },
					{ name: '敗北時', value: '15分 Timeout', inline: false },
					{ name: '勝利時', value: '24時間「上級ロメダ民」', inline: true }
				)
				.setColor(0x000000)
				.setThumbnail('https://cdn.discordapp.com/emojis/1198240562545954936.webp');

			await interaction.reply({
				content: isOpenChallenge ? null : `${opponentUser}`,
				embeds: [embed],
				components: [row],
			});

			// フィルター: 相手が指定されている場合はその人のみ、指定されていない場合は挑戦者以外なら誰でも
			const filter = isOpenChallenge
				? (i) => i.user.id !== userId && i.customId === buttonCustomId
				: (i) =>
						i.user.id === opponentUser.id &&
						(i.customId.startsWith('russian_accept_') || i.customId.startsWith('russian_deny_'));
			const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

			// Timeout Handler for Invite (Russian)
			collector.on('end', async (collected) => {
				if (collected.size === 0) {
					clearUserGame(userId);
					try {
						await interaction.editReply({
							content: '⌛ 時間切れでデスマッチはキャンセルされました。',
							components: [],
						});
					} catch (e) {
						// インタラクションがタイムアウトしている場合はチャンネルに送信
						if (e.code === 10062 || e.code === 40060) {
							await interaction.channel.send('⌛ 時間切れでデスマッチはキャンセルされました。').catch(() => {});
						}
					}
					// Penalty for Ignoring
					// const opponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);
					// if (opponentMember && opponentMember.moderatable) {
					//     try {
					//         await opponentMember.timeout(5 * 60 * 1000, 'Russian Ignored');
					//         await interaction.channel.send(`💤 ${opponentUser} は無視を決め込んだ罪で5分間拘束されました。`);
					//     } catch (e) { }
					// }
				}
			});
			collector.on('collect', async (i) => {
				// 受諾したユーザーを取得（open challengeの場合）
				let actualOpponentUser = opponentUser;
				let actualOpponentMember = null;

				if (isOpenChallenge) {
					actualOpponentUser = i.user;
					actualOpponentMember = await interaction.guild.members
						.fetch(actualOpponentUser.id)
						.catch(() => null);

					if (!actualOpponentMember) {
						return i.reply({ content: 'メンバー情報を取得できませんでした。', ephemeral: true });
					}

					// 被爆ロールチェック：受諾者が被爆ロールを持っている場合は受諾できない
					if (actualOpponentMember.roles.cache.has(RADIATION_ROLE_ID)) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('被爆ロールがついているため、対戦を受諾できません。')
							.setColor(0xff0000);
						return i.reply({ embeds: [errorEmbed], ephemeral: true });
					}

					if (actualOpponentUser.bot) {
						return i.reply({ content: 'Botと対戦することはできません。', ephemeral: true });
					}
				} else {
					actualOpponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);
					if (!actualOpponentMember) {
						return i.reply({ content: '対戦相手のメンバー情報を取得できませんでした。', ephemeral: true });
					}
				}

				// Start
				await setDataWithPrefix(userId, cooldowns, 'battle_', Date.now());
				try {
					fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
					require('../features/persistence').save(client);
				} catch (e) {}

				// Game State
				let cylinder = [0, 0, 0, 0, 0, 0];
				cylinder[Math.floor(Math.random() * 6)] = 1; // Load 1 bullet

				let state = {
					current: 0, // Cylinder Index
					turn: userId,
				};

				const triggerCustomId = isOpenChallenge
					? `russian_trigger_${userId}_${actualOpponentUser.id}`
					: `russian_trigger_${userId}_${opponentUser.id}`;

				const triggerRow = new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId(triggerCustomId)
						.setLabel('引金を引く')
						.setStyle(ButtonStyle.Danger)
						.setEmoji('💀')
				);

				const gameEmbed = new EmbedBuilder()
					.setTitle('🎲 ゲーム開始')
					.setDescription(`${interaction.user} vs ${actualOpponentUser}\n\n最初のターン: <@${state.turn}>`)
					.setColor(0xff0000);

				await i.update({ content: null, embeds: [gameEmbed], components: [triggerRow] });

				// ゲーム開始：進行状況を記録
				setUserGame(userId, 'duel_russian', `russian_${userId}_${actualOpponentUser.id}`);
				setUserGame(actualOpponentUser.id, 'duel_russian', `russian_${userId}_${actualOpponentUser.id}`);

				const gameFilter = (m) => m.user.id === state.turn && m.customId === triggerCustomId;
				const gameCollector = interaction.channel.createMessageComponentCollector({
					filter: gameFilter,
					time: 30000,
				});

				gameCollector.on('collect', async (move) => {
					if (move.user.id !== state.turn)
						return move.reply({ content: 'あなたの番ではありません。', ephemeral: true });

					// 完全ランダム（シリンダーの結果のみ）
					const isHit = cylinder[state.current] === 1;

					if (isHit) {
						const deathEmbed = new EmbedBuilder()
							.setTitle('💥 BANG!!!')
							.setDescription(
								`<@${move.user.id}> の頭部が吹き飛びました。\n\n🏆 **勝者:** ${
									move.user.id === userId ? actualOpponentUser : interaction.user
								}`
							)
							.setColor(0x880000)
							.setImage('https://media1.tenor.com/m/X215c2D-i_0AAAAC/gun-gunshot.gif'); // Optional: Add visual flair

						await move.update({ content: null, embeds: [deathEmbed], components: [] });
						gameCollector.stop('death');

						// Process Death
						const loserId = move.user.id;
						const winnerId = loserId === userId ? actualOpponentUser.id : userId;

						// ゲーム終了：進行状況をクリア
						clearUserGame(userId);
						clearUserGame(actualOpponentUser.id);

						const loserMember = await interaction.guild.members.fetch(loserId).catch(() => null);
						const winnerMember = await interaction.guild.members.fetch(winnerId).catch(() => null);

						// Penalty: Timeout
						if (loserMember) {
							// STANDARD TIMEOUT (10m)
							let timeoutDuration = 10 * 60 * 1000; // 10分

							if (loserMember.moderatable) {
								try {
									await loserMember.timeout(timeoutDuration, 'Russian Deathpoints').catch(() => {});

									// タイムアウト適用時にメッセージを送信
									try {
										await interaction.channel.send(`⚰️ ${loserMember} は闇に葬られました...`);
									} catch (e) {
										console.error('メッセージ送信エラー:', e);
									}
								} catch (e) {
									console.error('タイムアウト適用エラー:', e);
								}
							}
						}

						// Reward
						if (winnerMember) {
							try {
								await winnerMember.roles.add(ELITE_ROLE_ID);
								setTimeout(
									() => winnerMember.roles.remove(ELITE_ROLE_ID).catch(() => {}),
									24 * 60 * 60 * 1000
								);

								// Stats Update
								const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
								let duelData = {};
								if (fs.existsSync(DATA_FILE)) {
									try {
										duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
									} catch (e) {}
								}
								if (!duelData[winnerId])
									duelData[winnerId] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
								duelData[winnerId].wins++;
								duelData[winnerId].streak++;
								if (duelData[winnerId].streak > duelData[winnerId].maxStreak)
									duelData[winnerId].maxStreak = duelData[winnerId].streak;
								try {
									fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2));
								} catch (e) {}

								// Highlight
								const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
								if (highlightChannel) {
									interaction.channel.send(
										`✨ **勝者** <@${winnerId}> は死地を潜り抜けました！ (現在 ${duelData[winnerId].streak}連勝)`
									);
								}
							} catch (e) {}
						}

						return;
					} else {
						// Miss - Next Turn
						state.current++;
						state.turn = state.turn === userId ? actualOpponentUser.id : userId;
						const nextEmbed = new EmbedBuilder()
							.setTitle('💨 Click...')
							.setDescription('セーフです。')
							.addFields(
								{ name: '次のターン', value: `<@${state.turn}>`, inline: true },
								{ name: 'シリンダー', value: `${state.current + 1}/6`, inline: true }
							)
							.setColor(0x57f287); // Green

						await move.update({ content: null, embeds: [nextEmbed], components: [triggerRow] });
					}
				});

				gameCollector.on('end', async (c, reason) => {
					if (reason !== 'death') {
						interaction.channel.send(`⌛ <@${state.turn}> の戦意喪失によりゲーム終了。`);
						
						// ロメコイン返却処理
						try {
							await updateRomecoin(
								userId,
								(current) => Math.round((current || 0) + bet),
								{
									log: true,
									client: interaction.client,
									reason: `ロシアンルーレット無効試合: タイムアウトによる返却`,
									metadata: {
										targetUserId: actualOpponentUser.id,
										commandName: 'duel_russian',
									},
								}
							);
							await updateRomecoin(
								actualOpponentUser.id,
								(current) => Math.round((current || 0) + bet),
								{
									log: true,
									client: interaction.client,
									reason: `ロシアンルーレット無効試合: タイムアウトによる返却`,
									metadata: {
										targetUserId: userId,
										commandName: 'duel_russian',
									},
								}
							);
							await interaction.channel.send(
								`💰 無効試合のため、両プレイヤーに ${ROMECOIN_EMOJI}${bet} を返却しました。`
							);
						} catch (e) {
							console.error('ロメコイン返却エラー:', e);
						}
						
						// Penalty for Stalling
						const cowardMember = await interaction.guild.members.fetch(state.turn).catch(() => null);
						if (cowardMember && cowardMember.moderatable) {
							try {
								await cowardMember.timeout(5 * 60 * 1000, 'Russian Stalling');
								await interaction.channel.send(
									`👮 <@${state.turn}> は遅延行為により5分間拘束されました。`
								);
							} catch (e) {}
						}
						
						// ゲーム終了：進行状況をクリア
						clearUserGame(userId);
						clearUserGame(actualOpponentUser.id);
					}
				});
			});
			} catch (error) {
				clearUserGame(userId);
				console.error('duel_russianコマンドエラー:', error);
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
				}
			}
			return;
		}

		// === ADMIN SUITE ===
		const ADMIN_COMMANDS = ['admin_control', 'admin_user_mgmt', 'admin_logistics', 'activity_backfill'];
		if (ADMIN_COMMANDS.includes(interaction.commandName)) {
			// Permission Check
			if (!interaction.member) {
				return interaction.reply({ content: '⛔ このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
			}
			if (!(await checkAdmin(interaction.member))) {
				return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
			}

			// Defer Reply
			try {
				if (!interaction.deferred && !interaction.replied) {
					await interaction.deferReply({ ephemeral: true });
				}
			} catch (deferErr) {
				if (deferErr.code === 10062 || deferErr.code === 40060) return; // Interaction expired
				console.error('Admin Defer Error:', deferErr);
			}

			try {
				const subcommand = interaction.options.getSubcommand(false);

				// --- Admin Control ---
				if (interaction.commandName === 'admin_control') {
					const channel = interaction.options.getChannel('channel') || interaction.channel;

					if (subcommand === 'lock') {
						await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
							SendMessages: false,
						});
						const embed = new EmbedBuilder()
							.setDescription(`🔒 ${channel} をロックしました。`)
							.setColor(0xff0000);
						await interaction.editReply({ content: null, embeds: [embed] });
					} else if (subcommand === 'unlock') {
						await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
							SendMessages: null,
						});
						const embed = new EmbedBuilder()
							.setDescription(`🔓 ${channel} のロックを解除しました。`)
							.setColor(0x00ff00);
						await interaction.editReply({ content: null, embeds: [embed] });
					} else if (subcommand === 'slowmode') {
						const seconds = interaction.options.getInteger('seconds');
						await channel.setRateLimitPerUser(seconds);
						const embed = new EmbedBuilder()
							.setDescription(`⏱️ ${channel} の低速モードを ${seconds}秒 に設定しました。`)
							.setColor(0x0099ff);
						await interaction.editReply({ content: null, embeds: [embed] });
					} else if (subcommand === 'wipe') {
						if (channel.id === MAIN_CHANNEL_ID)
							return interaction.editReply('❌ メインチャンネルはWipeできません。');

						await interaction.editReply('⚠️ Wipeを実行します...');
						const position = channel.position;
						const newChannel = await channel.clone();
						await channel.delete();
						await newChannel.setPosition(position);
						await newChannel.send('🧹 このチャンネルは管理者によってWipe（再生成）されました。');
					}
				}

				// --- Admin User Management ---
				else if (interaction.commandName === 'admin_user_mgmt') {
					const targetUser = interaction.options.getUser('target');
					// subcommand 'whois' doesn't strictly need a member object if they left, but we try to fetch.
					const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

					if (subcommand === 'action') {
						const type = interaction.options.getString('type');
						const reason = interaction.options.getString('reason') || '管理者操作';

						if (type === 'unban') {
							await interaction.guild.members.unban(targetUser.id, reason);
							const embed = new EmbedBuilder()
								.setTitle('✅ Unban Success')
								.setDescription(`${targetUser.tag} のBanを解除しました。`)
								.setColor(0x00ff00);
							await interaction.editReply({ content: null, embeds: [embed] });
						} else {
							if (!member)
								return interaction.editReply({
									embeds: [
										new EmbedBuilder()
											.setTitle('❌ User Not Found')
											.setColor(0xff0000)
											.setDescription('ユーザーがサーバーに見つかりません。'),
									],
								});

							if (type === 'timeout') {
								const duration = interaction.options.getInteger('duration') || 60;
								await member.timeout(duration * 60 * 1000, reason);
								const embed = new EmbedBuilder()
									.setTitle('✅ Timeout Success')
									.setDescription(`${targetUser.tag} を ${duration}分間タイムアウトしました。`)
									.setColor(0xffa500);
								await interaction.editReply({ content: null, embeds: [embed] });
							} else if (type === 'untimeout') {
								await member.timeout(null, reason);
								const embed = new EmbedBuilder()
									.setTitle('✅ Untimeout Success')
									.setDescription(`${targetUser.tag} のタイムアウトを解除しました。`)
									.setColor(0x00ff00);
								await interaction.editReply({ content: null, embeds: [embed] });
							} else if (type === 'kick') {
								if (!member.kickable)
									return interaction.editReply({
										embeds: [
											new EmbedBuilder()
												.setColor(0xff0000)
												.setDescription('❌ このユーザーをKickできません。'),
										],
									});
								await member.kick(reason);
								const embed = new EmbedBuilder()
									.setTitle('✅ Kick Success')
									.setDescription(`${targetUser.tag} をKickしました。`)
									.setColor(0xffa500);
								await interaction.editReply({ content: null, embeds: [embed] });
							} else if (type === 'ban') {
								if (!member.bannable)
									return interaction.editReply({
										embeds: [
											new EmbedBuilder()
												.setColor(0xff0000)
												.setDescription('❌ このユーザーをBanできません。'),
										],
									});
								await member.ban({ reason });
								const embed = new EmbedBuilder()
									.setTitle('✅ Ban Success')
									.setDescription(`${targetUser.tag} をBanしました。`)
									.setColor(0xff0000);
								await interaction.editReply({ content: null, embeds: [embed] });
							}
						}
					} else if (subcommand === 'nick') {
						if (!member) return interaction.editReply('❌ ユーザーが見つかりません。');
						const name = interaction.options.getString('name') || null; // null to reset
						await member.setNickname(name);
						await interaction.editReply(
							name
								? `✅ ${targetUser.tag} の名前を "${name}" に変更しました。`
								: `✅ ${targetUser.tag} の名前をリセットしました。`
						);
					} else if (subcommand === 'dm') {
						const content = interaction.options.getString('content');
						const isAnonymous = interaction.options.getBoolean('anonymous');

						const dmChannel = await targetUser.createDM();
						if (isAnonymous) {
							await dmChannel.send(`【管理者より】\n${content}`);
						} else {
							const embed = new EmbedBuilder()
								.setTitle('管理者からのメッセージ')
								.setDescription(content)
								.setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
								.setColor(0xff0000);
							await dmChannel.send({ embeds: [embed] });
						}
						await interaction.editReply(`✅ ${targetUser.tag} にDMを送信しました。`);
					} else if (subcommand === 'whois') {
						const embed = new EmbedBuilder()
							.setTitle(`About ${targetUser.tag}`)
							.setThumbnail(targetUser.displayAvatarURL())
							.addFields(
								{ name: 'User ID', value: targetUser.id, inline: true },
								{
									name: 'Account Created',
									value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`,
									inline: true,
								},
								{
									name: 'Joined Server',
									value: member
										? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
										: 'Not in server',
									inline: true,
								},
								{
									name: 'Roles',
									value: member ? member.roles.cache.map((r) => r.toString()).join(' ') : 'N/A',
								}
							)
							.setColor(0x00bfff);
						await interaction.editReply({ embeds: [embed] });
					}
				}

				// --- Admin Logistics ---
				else if (interaction.commandName === 'admin_logistics') {
					if (subcommand === 'move_all') {
						const fromCh = interaction.options.getChannel('from');
						const toCh = interaction.options.getChannel('to');
						if (fromCh.type !== ChannelType.GuildVoice || toCh.type !== ChannelType.GuildVoice) {
							return interaction.editReply({
								embeds: [
									new EmbedBuilder()
										.setColor(0xff0000)
										.setDescription('❌ 音声チャンネルを指定してください。'),
								],
							});
						}
						const members = fromCh.members;
						let count = 0;
						for (const [id, m] of members) {
							await m.voice.setChannel(toCh);
							count++;
						}
						await interaction.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(0x00ff00)
									.setDescription(
										`🚚 ${count}人を ${fromCh.name} から ${toCh.name} に移動しました。`
									),
							],
						});
					} else if (subcommand === 'say') {
						const channel = interaction.options.getChannel('channel');
						const content = interaction.options.getString('content');
						const replyToId = interaction.options.getString('reply_to');
						const deleteAfter = interaction.options.getInteger('delete_after');
						const repeat = Math.min(interaction.options.getInteger('repeat') || 1, 10);

						if (!channel.isTextBased())
							return interaction.editReply({
								embeds: [
									new EmbedBuilder()
										.setColor(0xff0000)
										.setDescription('❌ テキストチャンネルを指定してください。'),
								],
							});

						for (let i = 0; i < repeat; i++) {
							let sentMsg;
							if (replyToId) {
								try {
									const targetMsg = await channel.messages.fetch(replyToId);
									sentMsg = await targetMsg.reply(content);
								} catch (e) {
									sentMsg = await channel.send(`(Reply Failed: ${replyToId}) ${content}`);
								}
							} else {
								sentMsg = await channel.send(content);
							}

							if (deleteAfter && deleteAfter > 0) {
								setTimeout(() => sentMsg.delete().catch(() => {}), deleteAfter * 1000);
							}
							if (repeat > 1) await new Promise((r) => setTimeout(r, 1000));
						}
						const deleteNote = deleteAfter ? ` (🗑️ ${deleteAfter}秒後に消滅)` : '';
						const repeatNote = repeat > 1 ? ` (🔁 ${repeat}回)` : '';
						await interaction.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(0x00ff00)
									.setDescription(`✅ ${channel} に発言しました。${repeatNote}${deleteNote}`),
							],
						});
					} else if (subcommand === 'create') {
						const name = interaction.options.getString('name');
						const cType =
							interaction.options.getString('type') === 'voice'
								? ChannelType.GuildVoice
								: ChannelType.GuildText;
						const catId = interaction.options.getString('category');
						const opts = { name, type: cType };
						if (catId) opts.parent = catId;
						const newCh = await interaction.guild.channels.create(opts);
						await interaction.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(0x00ff00)
									.setDescription(`✅ チャンネル ${newCh} を作成しました。`),
							],
						});
					} else if (subcommand === 'delete') {
						const ch = interaction.options.getChannel('channel');
						await ch.delete();
						await interaction.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(0x00ff00)
									.setDescription(`✅ チャンネル ${ch.name} を削除しました。`),
							],
						});
					} else if (subcommand === 'purge') {
						const channel = interaction.options.getChannel('channel') || interaction.channel;
						const amount = interaction.options.getInteger('amount');
						const user = interaction.options.getUser('user');
						const keyword = interaction.options.getString('keyword');

						const msgs = await channel.messages.fetch({ limit: 100 });
						let filtered = msgs;
						if (user) filtered = filtered.filter((m) => m.author.id === user.id);
						if (keyword) filtered = filtered.filter((m) => m.content.includes(keyword));

						const toDelete = filtered.first(amount);
						if (!toDelete || toDelete.length === 0)
							return interaction.editReply({
								embeds: [new EmbedBuilder().setColor(0xffa500).setDescription('対象なし')],
							});

						await channel.bulkDelete(toDelete, true);
						await interaction.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(0x00ff00)
									.setDescription(`✅ ${toDelete.length}件削除しました。`),
							],
						});
					} else if (subcommand === 'role') {
						const target = interaction.options.getUser('target');
						const role = interaction.options.getRole('role');
						const action = interaction.options.getString('action');
						const member = await interaction.guild.members.fetch(target.id);
						if (action === 'give') await member.roles.add(role);
						else await member.roles.remove(role);
						await interaction.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(0x00ff00)
									.setDescription(`✅ ${target.tag} に ${role.name} を ${action} しました。`),
							],
						});
					}
				}

				// --- Activity Backfill ---
				else if (interaction.commandName === 'activity_backfill') {
					const ActivityTracker = require('../features/activityTracker');
					await interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0x00ff00)
								.setDescription('✅ アクティビティログのBackfill（過去ログ取得）を手動開始します...'),
						],
					});

					ActivityTracker.backfill(interaction.client).catch((e) => {
						console.error('Backfill Error:', e);
					});
				}
			} catch (error) {
				console.error('Admin Command Error:', error);
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle('Admin Error')
							.setColor(0xff0000)
							.setDescription(`⚠ エラーが発生しました: ${error.message}`),
					],
				});
			}
			return;
		}

		// === 月間ランキング賞金付与コマンド ===
		if (interaction.commandName === 'monthly_ranking_rewards') {
			// 権限チェック
			if (!interaction.member) {
				return interaction.reply({ content: '⛔ このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
			}
			if (!(await checkAdmin(interaction.member))) {
				return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
			}

			try {
				await interaction.deferReply({ ephemeral: true });

				// 賞金額の定義（MDファイルの通り）
				const rewards = {
					1: 15000,
					2: 12000,
					3: 10000,
					4: 8000,
					5: 6000,
					6: 5000,
					7: 4000,
					8: 3000,
					9: 2500,
					10: 2000,
				};

				// 1位から10位までのユーザーを取得
				const rewardsList = [];
				let totalRewardAmount = 0;

				for (let rank = 1; rank <= 10; rank++) {
					const user = interaction.options.getUser(`rank${rank}`);
					if (user) {
						const rewardAmount = rewards[rank];
						if (rewardAmount) {
							rewardsList.push({ rank, user, rewardAmount });
							totalRewardAmount += rewardAmount;
						}
					}
				}

				if (rewardsList.length === 0) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0xff0000)
								.setDescription('❌ 少なくとも1人以上のユーザーを指定してください。'),
						],
					});
				}

				// 各ユーザーにロメコインを付与
				const results = [];
				for (const { rank, user, rewardAmount } of rewardsList) {
					try {
						await updateRomecoin(
							user.id,
							(current) => Math.round((current || 0) + rewardAmount),
							{
								log: true,
								client: interaction.client,
								reason: `月間ランキング賞金付与: ${rank}位`,
								metadata: {
									executorId: interaction.user.id,
									commandName: 'monthly_ranking_rewards',
								},
							}
						);
						const newBalance = await getRomecoin(user.id);
						results.push({
							rank,
							user,
							rewardAmount,
							newBalance,
							success: true,
						});
					} catch (error) {
						console.error(`[MonthlyRewards] エラー (${rank}位: ${user.id}):`, error);
						results.push({
							rank,
							user,
							rewardAmount,
							success: false,
							error: error.message,
						});
					}
				}

				// 結果を表示
				const successCount = results.filter((r) => r.success).length;
				const failCount = results.filter((r) => !r.success).length;

				const resultEmbed = new EmbedBuilder()
					.setTitle('✅ 賞金一括付与完了')
					.setColor(successCount === rewardsList.length ? 0x00ff00 : 0xffa500)
					.setDescription(
						`月間ランキング賞金の一括付与を実行しました\n成功: ${successCount}人 / 失敗: ${failCount}人\n合計賞金額: ${ROMECOIN_EMOJI}${totalRewardAmount.toLocaleString()}`
					);

				// 成功したユーザーの詳細（最大10件）
				const successResults = results.filter((r) => r.success).slice(0, 10);
				if (successResults.length > 0) {
					// フィールドを分割（1-5位と6-10位）
					const top5 = successResults.slice(0, 5);
					const top6to10 = successResults.slice(5, 10);

					if (top5.length > 0) {
						const details1to5 = top5
							.map(
								(r) =>
									`**${r.rank}位:** ${r.user} - ${ROMECOIN_EMOJI}${r.rewardAmount.toLocaleString()} (残高: ${ROMECOIN_EMOJI}${r.newBalance.toLocaleString()})`
							)
							.join('\n');
						resultEmbed.addFields({ name: '付与詳細 (1-5位)', value: details1to5, inline: false });
					}

					if (top6to10.length > 0) {
						const details6to10 = top6to10
							.map(
								(r) =>
									`**${r.rank}位:** ${r.user} - ${ROMECOIN_EMOJI}${r.rewardAmount.toLocaleString()} (残高: ${ROMECOIN_EMOJI}${r.newBalance.toLocaleString()})`
							)
							.join('\n');
						resultEmbed.addFields({ name: '付与詳細 (6-10位)', value: details6to10, inline: false });
					}
				}

				// 失敗したユーザーの詳細
				const failResults = results.filter((r) => !r.success);
				if (failResults.length > 0) {
					const failDetails = failResults
						.map((r) => `**${r.rank}位:** ${r.user} - エラー: ${r.error}`)
						.join('\n');
					// 失敗詳細も1024文字制限を考慮して分割
					if (failDetails.length > 1024) {
						const failDetails1 = failResults
							.slice(0, Math.ceil(failResults.length / 2))
							.map((r) => `**${r.rank}位:** ${r.user} - エラー: ${r.error}`)
							.join('\n');
						const failDetails2 = failResults
							.slice(Math.ceil(failResults.length / 2))
							.map((r) => `**${r.rank}位:** ${r.user} - エラー: ${r.error}`)
							.join('\n');
						resultEmbed.addFields({ name: '❌ エラー (1)', value: failDetails1, inline: false });
						if (failDetails2) {
							resultEmbed.addFields({ name: '❌ エラー (2)', value: failDetails2, inline: false });
						}
					} else {
						resultEmbed.addFields({ name: '❌ エラー', value: failDetails, inline: false });
					}
				}

				resultEmbed.setTimestamp();

				await interaction.editReply({ embeds: [resultEmbed] });
			} catch (error) {
				console.error('月間ランキング賞金付与エラー:', error);
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle('❌ エラー')
							.setColor(0xff0000)
							.setDescription(`賞金付与中にエラーが発生しました: ${error.message}`),
					],
				});
			}
			return;
		}

		// === 人気者選手権賞金付与コマンド ===
		if (interaction.commandName === 'popularity_championship_rewards') {
			// 権限チェック
			if (!interaction.member) {
				return interaction.reply({ content: '⛔ このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
			}
			if (!(await checkAdmin(interaction.member))) {
				return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
			}

			try {
				await interaction.deferReply({ ephemeral: true });

				// 月間ランキングの賞金額の2倍（MDファイルの通り）
				const rewards = {
					1: 30000, // 15,000 × 2
					2: 24000, // 12,000 × 2
					3: 20000, // 10,000 × 2
					4: 16000, // 8,000 × 2
					5: 12000, // 6,000 × 2
					6: 10000, // 5,000 × 2
					7: 8000, // 4,000 × 2
					8: 6000, // 3,000 × 2
					9: 5000, // 2,500 × 2
					10: 4000, // 2,000 × 2
				};

				// 1位から10位までのユーザーを取得
				const rewardsList = [];
				let totalRewardAmount = 0;

				for (let rank = 1; rank <= 10; rank++) {
					const user = interaction.options.getUser(`rank${rank}`);
					if (user) {
						const rewardAmount = rewards[rank];
						if (rewardAmount) {
							rewardsList.push({ rank, user, rewardAmount });
							totalRewardAmount += rewardAmount;
						}
					}
				}

				if (rewardsList.length === 0) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0xff0000)
								.setDescription('❌ 少なくとも1人以上のユーザーを指定してください。'),
						],
					});
				}

				// 各ユーザーにロメコインを付与
				const results = [];
				for (const { rank, user, rewardAmount } of rewardsList) {
					try {
						await updateRomecoin(
							user.id,
							(current) => Math.round((current || 0) + rewardAmount),
							{
								log: true,
								client: interaction.client,
								reason: `人気者選手権賞金付与: ${rank}位`,
								metadata: {
									executorId: interaction.user.id,
									commandName: 'popularity_championship_rewards',
								},
							}
						);
						const newBalance = await getRomecoin(user.id);
						results.push({
							rank,
							user,
							rewardAmount,
							newBalance,
							success: true,
						});
					} catch (error) {
						console.error(`[PopularityChampionshipRewards] エラー (${rank}位: ${user.id}):`, error);
						results.push({
							rank,
							user,
							rewardAmount,
							success: false,
							error: error.message,
						});
					}
				}

				// 結果を表示
				const successCount = results.filter((r) => r.success).length;
				const failCount = results.filter((r) => !r.success).length;

				const resultEmbed = new EmbedBuilder()
					.setTitle('✅ 人気者選手権賞金一括付与完了')
					.setColor(successCount === rewardsList.length ? 0x00ff00 : 0xffa500)
					.setDescription(
						`人気者選手権賞金の一括付与を実行しました\n成功: ${successCount}人 / 失敗: ${failCount}人\n合計賞金額: ${ROMECOIN_EMOJI}${totalRewardAmount.toLocaleString()}`
					);

				// 成功したユーザーの詳細（最大10件）
				const successResults = results.filter((r) => r.success).slice(0, 10);
				if (successResults.length > 0) {
					// フィールドを分割（1-5位と6-10位）
					const top5 = successResults.slice(0, 5);
					const top6to10 = successResults.slice(5, 10);

					if (top5.length > 0) {
						const details1to5 = top5
							.map(
								(r) =>
									`**${r.rank}位:** ${r.user} - ${ROMECOIN_EMOJI}${r.rewardAmount.toLocaleString()} (残高: ${ROMECOIN_EMOJI}${r.newBalance.toLocaleString()})`
							)
							.join('\n');
						resultEmbed.addFields({ name: '付与詳細 (1-5位)', value: details1to5, inline: false });
					}

					if (top6to10.length > 0) {
						const details6to10 = top6to10
							.map(
								(r) =>
									`**${r.rank}位:** ${r.user} - ${ROMECOIN_EMOJI}${r.rewardAmount.toLocaleString()} (残高: ${ROMECOIN_EMOJI}${r.newBalance.toLocaleString()})`
							)
							.join('\n');
						resultEmbed.addFields({ name: '付与詳細 (6-10位)', value: details6to10, inline: false });
					}
				}

				// 失敗したユーザーの詳細
				const failResults = results.filter((r) => !r.success);
				if (failResults.length > 0) {
					const failDetails = failResults
						.map((r) => `**${r.rank}位:** ${r.user} - エラー: ${r.error}`)
						.join('\n');
					// 失敗詳細も1024文字制限を考慮して分割
					if (failDetails.length > 1024) {
						const failDetails1 = failResults
							.slice(0, Math.ceil(failResults.length / 2))
							.map((r) => `**${r.rank}位:** ${r.user} - エラー: ${r.error}`)
							.join('\n');
						const failDetails2 = failResults
							.slice(Math.ceil(failResults.length / 2))
							.map((r) => `**${r.rank}位:** ${r.user} - エラー: ${r.error}`)
							.join('\n');
						resultEmbed.addFields({ name: '❌ エラー (1)', value: failDetails1, inline: false });
						if (failDetails2) {
							resultEmbed.addFields({ name: '❌ エラー (2)', value: failDetails2, inline: false });
						}
					} else {
						resultEmbed.addFields({ name: '❌ エラー', value: failDetails, inline: false });
					}
				}

				resultEmbed.setTimestamp();

				await interaction.editReply({ embeds: [resultEmbed] });
			} catch (error) {
				console.error('人気者選手権賞金付与エラー:', error);
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle('❌ エラー')
							.setColor(0xff0000)
							.setDescription(`賞金付与中にエラーが発生しました: ${error.message}`),
					],
				});
			}
			return;
		}

		// === 管理者専用ロメコイン操作コマンド ===
		if (interaction.commandName === 'admin_romecoin_add') {
			// 権限チェック
			if (!interaction.member) {
				return interaction.reply({ content: '⛔ このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
			}
			if (!(await checkAdmin(interaction.member))) {
				return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
			}

			try {
				await interaction.deferReply({ ephemeral: true });

				const targetUser = interaction.options.getUser('user');
				const amount = interaction.options.getInteger('amount');

				if (!targetUser) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0xff0000)
								.setDescription('❌ ユーザーを指定してください。'),
						],
					});
				}

				if (!amount || amount <= 0) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0xff0000)
								.setDescription('❌ 有効な金額（1以上）を指定してください。'),
						],
					});
				}

				// 現在の残高を取得
				const previousBalance = await getRomecoin(targetUser.id);

				// ロメコインを増額（ログ付き）
				await updateRomecoin(
					targetUser.id,
					(current) => Math.round((current || 0) + amount),
					{
						log: true,
						client: interaction.client,
						reason: `管理者による手動増額`,
						metadata: {
							executorId: interaction.user.id,
							commandName: 'admin_romecoin_add',
						},
					}
				);
				const newBalance = await getRomecoin(targetUser.id);

				const successEmbed = new EmbedBuilder()
					.setTitle('✅ ロメコイン増額成功')
					.setDescription(`${targetUser} のロメコインを ${ROMECOIN_EMOJI}${amount.toLocaleString()} 増額しました`)
					.addFields(
						{
							name: '増額前の残高',
							value: `${ROMECOIN_EMOJI}${previousBalance.toLocaleString()}`,
							inline: true,
						},
						{
							name: '増額後の残高',
							value: `${ROMECOIN_EMOJI}${newBalance.toLocaleString()}`,
							inline: true,
						},
						{
							name: '増額額',
							value: `${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
							inline: true,
						}
					)
					.setColor(0x00ff00)
					.setTimestamp()
					.setFooter({ text: `実行者: ${interaction.user.tag}` });

				await interaction.editReply({ embeds: [successEmbed] });
			} catch (error) {
				console.error('ロメコイン増額エラー:', error);
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle('❌ エラー')
							.setColor(0xff0000)
							.setDescription(`ロメコインの増額中にエラーが発生しました: ${error.message}`),
					],
				});
			}
			return;
		}

		if (interaction.commandName === 'admin_romecoin_deduct') {
			// 権限チェック
			if (!interaction.member) {
				return interaction.reply({ content: '⛔ このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
			}
			if (!(await checkAdmin(interaction.member))) {
				return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
			}

			try {
				await interaction.deferReply({ ephemeral: true });

				const targetUser = interaction.options.getUser('user');
				const amount = interaction.options.getInteger('amount');

				if (!targetUser) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0xff0000)
								.setDescription('❌ ユーザーを指定してください。'),
						],
					});
				}

				if (!amount || amount <= 0) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setColor(0xff0000)
								.setDescription('❌ 有効な金額（1以上）を指定してください。'),
						],
					});
				}

				// 現在の残高を取得
				const previousBalance = await getRomecoin(targetUser.id);

				if (previousBalance < amount) {
					return interaction.editReply({
						embeds: [
							new EmbedBuilder()
								.setTitle('❌ エラー')
								.setDescription('ユーザーのロメコインが不足しています')
								.addFields(
									{
										name: '現在の所持ロメコイン',
										value: `${ROMECOIN_EMOJI}${previousBalance.toLocaleString()}`,
										inline: true,
									},
									{
										name: '減額しようとする額',
										value: `${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
										inline: true,
									}
								)
								.setColor(0xff0000),
						],
					});
				}

				// ロメコインを減額（ログ付き）
				await updateRomecoin(
					targetUser.id,
					(current) => Math.round((current || 0) - amount),
					{
						log: true,
						client: interaction.client,
						reason: `管理者による手動減額`,
						metadata: {
							executorId: interaction.user.id,
							commandName: 'admin_romecoin_deduct',
						},
					}
				);
				const newBalance = await getRomecoin(targetUser.id);

				const successEmbed = new EmbedBuilder()
					.setTitle('✅ ロメコイン減額成功')
					.setDescription(`${targetUser} のロメコインを ${ROMECOIN_EMOJI}${amount.toLocaleString()} 減額しました`)
					.addFields(
						{
							name: '減額前の残高',
							value: `${ROMECOIN_EMOJI}${previousBalance.toLocaleString()}`,
							inline: true,
						},
						{
							name: '減額後の残高',
							value: `${ROMECOIN_EMOJI}${newBalance.toLocaleString()}`,
							inline: true,
						},
						{
							name: '減額額',
							value: `${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
							inline: true,
						}
					)
					.setColor(0xffa500)
					.setTimestamp()
					.setFooter({ text: `実行者: ${interaction.user.tag}` });

				await interaction.editReply({ embeds: [successEmbed] });
			} catch (error) {
				console.error('ロメコイン減額エラー:', error);
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle('❌ エラー')
							.setColor(0xff0000)
							.setDescription(`ロメコインの減額中にエラーが発生しました: ${error.message}`),
					],
				});
			}
			return;
		}
	} else if (interaction.isMessageContextMenuCommand()) {
		if (interaction.commandName === '匿名開示 (運営専用)') {
			try {
				// Robust Defer
				try {
					if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
				} catch (deferErr) {
					if (deferErr.code === 10062 || deferErr.code === 40060) return;
				}

				const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

				if (member && (member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(TECHTEAM_ROLE_ID))) {
					if (interaction.targetMessage.webhookId != null) {
						const webhook = await interaction.targetMessage.fetchWebhook().catch(() => null);
						if (webhook && webhook.name === 'CROSSROID Anonymous') {
							// Parse Info using Regex (Robust against format changes)
							const username = interaction.targetMessage.author.username;
							const idMatch = username.match(/ID:([a-z0-9]+)/i);
							const wacchoiMatch = username.match(/[(\uff08]ﾜｯﾁｮｲ\s+([a-z0-9-]+)[)\uff09]/i);

							const targetId = idMatch ? idMatch[1] : null;
							const targetWacchoi = wacchoiMatch ? wacchoiMatch[1] : null;

							if (!targetId && !targetWacchoi) {
								return await interaction.followUp({
									content: '❌ メッセージからIDまたはワッチョイを読み取れませんでした。',
									ephemeral: true,
								});
							}

							const { generateDailyUserIdForDate, generateWacchoi } = require('../utils');
							const msgDate = interaction.targetMessage.createdAt;
							const members = await interaction.guild.members.fetch();

							let foundMember = null;
							let reason = '';

							// Sequential Search
							for (const [_mid, m] of members) {
								if (targetId) {
									const genId = generateDailyUserIdForDate(m.id, msgDate);
									if (genId === targetId) {
										foundMember = m;
										reason = `ID一致: \`${genId}\``;
										break;
									}
								}
								if (!foundMember && targetWacchoi) {
									const genWacchoi = generateWacchoi(m.id, msgDate).full;
									if (genWacchoi === targetWacchoi) {
										foundMember = m;
										reason = `ワッチョイ一致: \`${genWacchoi}\``;
										break;
									}
								}
							}

							if (foundMember) {
								return await interaction.followUp({
									content: `🕵️ **特定成功**\nユーザー: ${foundMember} (${foundMember.user.tag})\nUID: \`${foundMember.id}\`\n根拠: ${reason}`,
									ephemeral: true,
								});
							} else {
								return await interaction.followUp({
									content: `❌ 該当するユーザーが見つかりませんでした。\n(Target ID: ${
										targetId || 'None'
									}, Wacchoi: ${
										targetWacchoi || 'None'
									})\n※ユーザーが退出したか、日付計算の不一致の可能性があります。`,
									ephemeral: true,
								});
							}
						}
					}
					return await interaction.followUp({
						content: '❌ 匿名メッセージとして認識できませんでした。',
						ephemeral: true,
					});
				} else {
					return await interaction.followUp({ content: '⛔ 権限がありません。', ephemeral: true });
				}
			} catch (e) {
				console.error('Anonymous Disclosure Error:', e);
				await interaction
					.followUp({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true })
					.catch(() => {});
			}
		}
	}

	// duel コマンド
	if (interaction.commandName === 'duel') {
		try {
			const userId = interaction.user.id;

			// 重複実行チェック（最初にチェック）
			if (isUserInGame(userId)) {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription(
						'あなたは現在他のゲーム（duel/duel_russian/janken）を実行中です。同時に実行できるのは1つだけです。'
					)
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
			}

			// 即座にロックをかける（重複対戦を防ぐ）
			const tempProgressId = `temp_duel_${userId}_${Date.now()}`;
			setUserGame(userId, 'duel', tempProgressId);

			// 被爆ロールチェック：被爆ロールがついている人は対戦コマンドを実行できない
			if (interaction.member.roles.cache.has(RADIATION_ROLE_ID)) {
				clearUserGame(userId);
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('被爆ロールがついているため、対戦コマンドを実行できません。')
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
			}

			const opponentUser = interaction.options.getUser('対戦相手');
			const bet = interaction.options.getInteger('bet') || 100; // デフォルト100
			const isOpenChallenge = !opponentUser; // 相手が指定されていない場合は誰でも挑戦可能

			const member = interaction.member;

			// ロメコインチェック
			const userRomecoin = await getRomecoin(userId);
			if (userRomecoin < bet) {
				clearUserGame(userId);
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('ロメコインが不足しています')
					.addFields(
						{ name: '現在の所持ロメコイン', value: `${ROMECOIN_EMOJI}${userRomecoin}`, inline: true },
						{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
					)
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
			}

			// ロールチェック（世代ロール必須）- 挑戦者のみ
			const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
			const isChallengerEligible =
				member.roles.cache.some((r) => romanRegex.test(r.name)) ||
				member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

			if (!isChallengerEligible) {
				clearUserGame(userId);
				return interaction.reply({
					content: 'あなたは決闘に参加するための世代ロールを持っていません。',
					ephemeral: true,
				});
			}

			// 相手が指定されている場合のバリデーション
			if (opponentUser) {
				if (opponentUser.id === userId) {
					clearUserGame(userId);
					return interaction.reply({ content: '自分自身と決闘することはできません。', ephemeral: true });
				}
				if (opponentUser.bot) {
					clearUserGame(userId);
					return interaction.reply({ content: 'Botと決闘することはできません。', ephemeral: true });
				}

				const opponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);
				if (!opponentMember) {
					clearUserGame(userId);
					return interaction.reply({
						content: '対戦相手のメンバー情報を取得できませんでした。',
						ephemeral: true,
					});
				}

				const isOpponentEligible =
					opponentMember.roles.cache.some((r) => romanRegex.test(r.name)) ||
					opponentMember.roles.cache.has(CURRENT_GENERATION_ROLE_ID);
				if (!isOpponentEligible) {
					clearUserGame(userId);
					return interaction.reply({
						content: '対戦相手は決闘に参加するための世代ロールを持っていません。',
						ephemeral: true,
					});
				}
			}

			// 決闘状UI
			const buttonCustomId = isOpenChallenge
				? `duel_accept_${userId}`
				: `duel_accept_${userId}_${opponentUser.id}`;

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(buttonCustomId)
					.setLabel('受けて立つ')
					.setStyle(ButtonStyle.Danger)
					.setEmoji('⚔️')
			);

			const embed = new EmbedBuilder()
				.setTitle('⚔️ 決闘状')
				.setDescription(
					isOpenChallenge
						? `${interaction.user} が誰でも挑戦可能な決闘を開始しました。\n\n**誰でも「受けて立つ」ボタンを押して挑戦できます！**`
						: `${opponentUser}\n${interaction.user} から決闘を申し込まれました。`
				)
				.addFields(
					{ name: 'ルール', value: '1d100のダイス勝負', inline: true },
					{ name: 'ルール', value: '完全ランダム（1-100）& 引き分けは防御側の勝利', inline: true },
					{ name: 'ベット', value: `${ROMECOIN_EMOJI}${bet}`, inline: true },
					{ name: 'ペナルティ', value: '敗者はタイムアウト（最大10分）', inline: false },
					{ name: '注意', value: '受諾後、キャンセル不可', inline: false }
				)
				.setColor(0xff0000)
				.setThumbnail(interaction.user.displayAvatarURL());

			await interaction.reply({
				content: isOpenChallenge ? null : `${opponentUser}`,
				embeds: [embed],
				components: [row],
			});

			// フィルター: 相手が指定されている場合はその人のみ、指定されていない場合は挑戦者以外なら誰でも
			const filter = isOpenChallenge
				? (i) => i.user.id !== userId && i.customId === buttonCustomId
				: (i) =>
						i.user.id === opponentUser.id &&
						(i.customId.startsWith('duel_accept_') || i.customId.startsWith('duel_deny_'));
			const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

			collector.on('collect', async (i) => {
				// 受諾したユーザーを取得（open challengeの場合）
				let actualOpponentUser = opponentUser;
				let actualOpponentMember = null;

				if (isOpenChallenge) {
					actualOpponentUser = i.user;
					actualOpponentMember = await interaction.guild.members
						.fetch(actualOpponentUser.id)
						.catch(() => null);

					if (!actualOpponentMember) {
						return i.reply({ content: 'メンバー情報を取得できませんでした。', ephemeral: true });
					}

					// 被爆ロールチェック：受諾者が被爆ロールを持っている場合は受諾できない
					if (actualOpponentMember.roles.cache.has(RADIATION_ROLE_ID)) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('被爆ロールがついているため、対戦を受諾できません。')
							.setColor(0xff0000);
						return i.reply({ embeds: [errorEmbed], ephemeral: true });
					}

					// 受諾者のロールチェック
					const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
					const isOpponentEligible =
						actualOpponentMember.roles.cache.some((r) => romanRegex.test(r.name)) ||
						actualOpponentMember.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

					if (!isOpponentEligible) {
						return i.reply({
							content: 'あなたは決闘に参加するための世代ロールを持っていません。',
							ephemeral: true,
						});
					}

					if (actualOpponentUser.bot) {
						return i.reply({ content: 'Botと決闘することはできません。', ephemeral: true });
					}

					// 受諾者のロメコインチェック
					const opponentRomecoin = await getRomecoin(actualOpponentUser.id);
					if (opponentRomecoin < bet) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('ロメコインが不足しています')
							.addFields(
								{
									name: '現在の所持ロメコイン',
									value: `${ROMECOIN_EMOJI}${opponentRomecoin}`,
									inline: true,
								},
								{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
							)
							.setColor(0xff0000);
						return i.reply({ embeds: [errorEmbed], ephemeral: true });
					}
				} else {
					actualOpponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);
					if (!actualOpponentMember) {
						return i.reply({ content: '対戦相手のメンバー情報を取得できませんでした。', ephemeral: true });
					}

					// 対戦相手のロメコインチェック
					const opponentRomecoin = await getRomecoin(opponentUser.id);
					if (opponentRomecoin < bet) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('対戦相手のロメコインが不足しています')
							.addFields(
								{
									name: `${opponentUser}の現在の所持ロメコイン`,
									value: `${ROMECOIN_EMOJI}${opponentRomecoin}`,
									inline: true,
								},
								{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
							)
							.setColor(0xff0000);
						return i.reply({ embeds: [errorEmbed], ephemeral: true });
					}
				}

				// 受諾
				const startEmbed = new EmbedBuilder()
					.setTitle('⚔️ 決闘開始')
					.setDescription(`${interaction.user} vs ${actualOpponentUser}\n\nダイスロール中... 🎲`)
					.setColor(0xffa500);

				await i.update({ content: null, embeds: [startEmbed], components: [] });

				// ゲーム開始：進行状況を記録
				setUserGame(userId, 'duel', `duel_${userId}_${actualOpponentUser.id}`);
				setUserGame(actualOpponentUser.id, 'duel', `duel_${userId}_${actualOpponentUser.id}`);

				await new Promise((r) => setTimeout(r, 2000));

				// 完全ランダム（1-100）
				const rollA = Math.floor(Math.random() * 100) + 1;
				const rollB = Math.floor(Math.random() * 100) + 1;

				let loser = null;
				let winner = null;
				let diff = 0;

				if (rollA > rollB) {
					diff = rollA - rollB;
					loser = actualOpponentMember;
					winner = member;
				} else {
					diff = Math.abs(rollB - rollA);
					loser = member;
					winner = actualOpponentMember;
				}

				// ロメコインのやり取り（ログ付き）
				await updateRomecoin(
					winner.user.id,
					(current) => Math.round((current || 0) + bet),
					{
						log: true,
						client: interaction.client,
						reason: `決闘勝利: ${loser.user.tag} との対戦`,
						metadata: {
							targetUserId: loser.user.id,
							commandName: 'duel',
						},
					}
				);
				await updateRomecoin(
					loser.user.id,
					(current) => Math.round((current || 0) - bet),
					{
						log: true,
						client: interaction.client,
						reason: `決闘敗北: ${winner.user.tag} との対戦`,
						metadata: {
							targetUserId: winner.user.id,
							commandName: 'duel',
						},
					}
				);

				// 戦績記録
				const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
				let duelData = {};
				if (fs.existsSync(DATA_FILE)) {
					try {
						duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
					} catch (e) {
						console.error('決闘データ読み込みエラー:', e);
					}
				}

				// データ引き継ぎ（ID → Notion名）
				await migrateData(winner.user.id, duelData);
				await migrateData(loser.user.id, duelData);

				// 勝者のデータを更新
				await updateData(winner.user.id, duelData, (current) => {
					const data = current || { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
					data.wins++;
					data.streak++;
					if (data.streak > data.maxStreak) {
						data.maxStreak = data.streak;
					}
					return data;
				});

				// 敗者のデータを更新
				await updateData(loser.user.id, duelData, (current) => {
					const data = current || { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
					data.losses++;
					data.streak = 0;
					return data;
				});

				try {
					fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2));
					// Memory storeに保存
					persistence.save(client).catch((err) => console.error('Memory store保存エラー:', err));
				} catch (e) {
					console.error('決闘データ書き込みエラー:', e);
				}

				// ゲーム終了：進行状況をクリア
				clearUserGame(userId);
				clearUserGame(actualOpponentUser.id);

				// 表示用にデータを取得
				const winnerData = await getData(winner.user.id, duelData, {
					wins: 0,
					losses: 0,
					streak: 0,
					maxStreak: 0,
				});

				// 3連勝以上で通知
				if (winnerData.streak >= 3) {
					const mainCh = client.channels.cache.get(MAIN_CHANNEL_ID);
					if (mainCh) {
						mainCh.send(`🔥 **NEWS:** ${winner} が決闘で **${winnerData.streak}連勝** を達成しました！`);
					}
					try {
						if (loser.moderatable) {
							const oldName = loser.nickname || loser.user.username;
							await loser.setNickname(`敗北者${oldName.substring(0, 20)}`).catch(() => {});
						}
					} catch (e) {}
				}

				// タイムアウト計算（最大10分）
				let timeoutMinutes = Math.ceil(diff / 4);
				if (loser.user.id === userId) {
					timeoutMinutes += 2; // 自害+2分
				}
				timeoutMinutes = Math.min(10, timeoutMinutes); // 計算後に最大10分に制限
				const timeoutMs = timeoutMinutes * 60 * 1000;

				// タイムアウト適用
				let timeoutSuccess = false;
				if (loser && loser.moderatable) {
					try {
						await loser
							.timeout(
								timeoutMs,
								`Dueled with ${
									rollA === rollB
										? 'Unknown'
										: loser.user.id === userId
										? actualOpponentUser.tag
										: interaction.user.tag
								}`
							)
							.catch(() => {});
						timeoutSuccess = true;

						// タイムアウト適用時にメッセージを送信
						try {
							await interaction.channel.send(`⚰️ ${loser} は闇に葬られました...`);
						} catch (e) {
							console.error('メッセージ送信エラー:', e);
						}
					} catch (e) {
						console.error('タイムアウト適用エラー:', e);
					}
				}

				// 挑戦状のembedを編集して結果を表示
				const resultEmbed = new EmbedBuilder()
					.setTitle(rollA === rollB ? '⚖️ 引き分け' : '🏆 決闘決着')
					.setColor(rollA === rollB ? 0x99aab5 : 0xffd700)
					.setDescription(`${interaction.user} vs ${actualOpponentUser}`)
					.addFields(
						{ name: `${interaction.user.username} (攻)`, value: `🎲 **${rollA}**`, inline: true },
						{ name: `${actualOpponentUser.username} (守)`, value: `🎲 **${rollB}**`, inline: true },
						{ name: '差', value: `${diff}`, inline: true },
						{
							name: '獲得/損失',
							value: `${winner} は ${ROMECOIN_EMOJI}${bet} を獲得\n${loser} は ${ROMECOIN_EMOJI}${bet} を失いました`,
							inline: false,
						}
					);

				if (timeoutSuccess) {
					resultEmbed.addFields({
						name: '処罰',
						value: `⚰️ ${loser} は ${timeoutMinutes}分間タイムアウトされました。`,
						inline: false,
					});
				}

				await interaction.editReply({
					content: null,
					embeds: [resultEmbed],
					components: [],
				});
			});

			// タイムアウトハンドラー
			collector.on('end', async (collected) => {
				if (collected.size === 0) {
					clearUserGame(userId);
					try {
						await interaction.editReply({
							content: '⏰ 時間切れで決闘がキャンセルされました。',
							components: [],
							embeds: [],
						});
					} catch (e) {
						// インタラクションがタイムアウトしている場合はチャンネルに送信
						if (e.code === 10062 || e.code === 40060) {
							await interaction.channel.send('⏰ 時間切れで決闘がキャンセルされました。').catch(() => {});
						}
					}
					// タイムアウト時も進行状況をクリア
					clearUserGame(userId);
					if (opponentUser) {
						clearUserGame(opponentUser.id);
					}
				}
			});
		} catch (error) {
			clearUserGame(userId);
			if (opponentUser) {
				clearUserGame(opponentUser.id);
			}
			console.error('決闘コマンドエラー:', error);
			if (interaction.deferred || interaction.replied) {
				return interaction.editReply({ content: 'エラーが発生しました。' });
			}
			return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
		}
		return;
	}

	// duel_russian コマンド
	if (interaction.commandName === 'duel_russian') {
		try {
			const userId = interaction.user.id;
			const opponentUser = interaction.options.getUser('対戦相手');
			const bet = interaction.options.getInteger('bet') || 100; // デフォルト100
			const isOpenChallenge = !opponentUser; // 相手が指定されていない場合は誰でも挑戦可能

			// ロメコインチェック
			const userRomecoin = await getRomecoin(userId);
			if (userRomecoin < bet) {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('ロメコインが不足しています')
					.addFields(
						{ name: '現在の所持ロメコイン', value: `${ROMECOIN_EMOJI}${userRomecoin}`, inline: true },
						{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
					)
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
			}

			// 相手が指定されている場合のバリデーション
			if (opponentUser) {
				if (opponentUser.id === userId || opponentUser.bot) {
					return interaction.reply({ content: '自分自身やBotとは対戦できません。', ephemeral: true });
				}

				// 対戦相手のロメコインチェック
				const opponentRomecoin = await getRomecoin(opponentUser.id);
				if (opponentRomecoin < bet) {
					const errorEmbed = new EmbedBuilder()
						.setTitle('❌ エラー')
						.setDescription('対戦相手のロメコインが不足しています')
						.addFields(
							{
								name: `${opponentUser}の現在の所持ロメコイン`,
								value: `${ROMECOIN_EMOJI}${opponentRomecoin}`,
								inline: true,
							},
							{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
						)
						.setColor(0xff0000);
					return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
				}
			}

			// UI
			const buttonCustomId = isOpenChallenge
				? `russian_accept_${userId}`
				: `russian_accept_${userId}_${opponentUser.id}`;

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(buttonCustomId)
					.setLabel('受けて立つ')
					.setStyle(ButtonStyle.Danger)
					.setEmoji('🔫')
			);

			const embed = new EmbedBuilder()
				.setTitle('☠️ ロシアン・ルーレット')
				.setDescription(
					isOpenChallenge
						? `${interaction.user} が誰でも挑戦可能なロシアンルーレットを開始しました。\n\n**誰でも「受けて立つ」ボタンを押して挑戦できます！**`
						: `${opponentUser}\n${interaction.user} から死のゲームへの招待です。`
				)
				.addFields(
					{ name: 'ルール', value: '1発の実弾が入ったリボルバーを交互に引き金を引く', inline: false },
					{ name: 'ベット', value: `${ROMECOIN_EMOJI}${bet}`, inline: true },
					{ name: '敗北時', value: '10分Timeout', inline: true },
					{ name: '勝利時', value: '戦績に記録', inline: true }
				)
				.setColor(0x000000)
				.setThumbnail('https://cdn.discordapp.com/emojis/1198240562545954936.webp');

			await interaction.reply({
				content: isOpenChallenge ? null : `${opponentUser}`,
				embeds: [embed],
				components: [row],
			});

			// フィルター: 相手が指定されている場合はその人のみ、指定されていない場合は挑戦者以外なら誰でも
			const filter = isOpenChallenge
				? (i) => i.user.id !== userId && i.customId === buttonCustomId
				: (i) =>
						i.user.id === opponentUser.id &&
						(i.customId.startsWith('russian_accept_') || i.customId.startsWith('russian_deny_'));
			const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

			collector.on('collect', async (i) => {
				// 受諾したユーザーを取得（open challengeの場合）
				let actualOpponentUser = opponentUser;
				let actualOpponentMember = null;

				if (isOpenChallenge) {
					actualOpponentUser = i.user;
					actualOpponentMember = await interaction.guild.members
						.fetch(actualOpponentUser.id)
						.catch(() => null);

					if (!actualOpponentMember) {
						return i.reply({ content: 'メンバー情報を取得できませんでした。', ephemeral: true });
					}

					// 被爆ロールチェック：受諾者が被爆ロールを持っている場合は受諾できない
					if (actualOpponentMember.roles.cache.has(RADIATION_ROLE_ID)) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('被爆ロールがついているため、対戦を受諾できません。')
							.setColor(0xff0000);
						return i.reply({ embeds: [errorEmbed], ephemeral: true });
					}

					if (actualOpponentUser.bot) {
						return i.reply({ content: 'Botと対戦することはできません。', ephemeral: true });
					}

					// 受諾者のロメコインチェック
					const opponentRomecoin = await getRomecoin(actualOpponentUser.id);
					if (opponentRomecoin < bet) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('ロメコインが不足しています')
							.addFields(
								{
									name: '現在の所持ロメコイン',
									value: `${ROMECOIN_EMOJI}${opponentRomecoin}`,
									inline: true,
								},
								{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
							)
							.setColor(0xff0000);
						return i.reply({ embeds: [errorEmbed], ephemeral: true });
					}
				} else {
					actualOpponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);
					if (!actualOpponentMember) {
						return i.reply({ content: '対戦相手のメンバー情報を取得できませんでした。', ephemeral: true });
					}
				}

				// ゲーム開始
				const cylinder = [0, 0, 0, 0, 0, 0];
				const bulletPos = Math.floor(Math.random() * 6);
				cylinder[bulletPos] = 1;

				const state = {
					current: 0,
					turn: userId,
				};

				const triggerCustomId = isOpenChallenge
					? `russian_trigger_${userId}_${actualOpponentUser.id}`
					: `russian_trigger_${userId}_${opponentUser.id}`;

				const triggerRow = new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId(triggerCustomId)
						.setLabel('引き金を引く')
						.setStyle(ButtonStyle.Danger)
						.setEmoji('🔫')
				);

				const startEmbed = new EmbedBuilder()
					.setTitle('🔫 ロシアンルーレット開始')
					.setDescription(`${interaction.user} vs ${actualOpponentUser}\n\n最初のターン: <@${state.turn}>`)
					.setColor(0xff0000);

				await i.update({ content: null, embeds: [startEmbed], components: [triggerRow] });

				// ゲーム開始：進行状況を記録
				setUserGame(userId, 'duel_russian', `russian_${userId}_${actualOpponentUser.id}`);
				setUserGame(actualOpponentUser.id, 'duel_russian', `russian_${userId}_${actualOpponentUser.id}`);

				const gameFilter = (m) => m.user.id === state.turn && m.customId === triggerCustomId;
				const gameCollector = interaction.channel.createMessageComponentCollector({
					filter: gameFilter,
					time: 30000,
				});

				gameCollector.on('collect', async (move) => {
					if (move.user.id !== state.turn) {
						return move.reply({ content: 'あなたの番ではありません。', ephemeral: true });
					}

					const isHit = cylinder[state.current] === 1;

					if (isHit) {
						const winnerUser = move.user.id === userId ? actualOpponentUser : interaction.user;
						const loserUser = move.user.id === userId ? interaction.user : actualOpponentUser;

						const deathEmbed = new EmbedBuilder()
							.setTitle('💥 BANG!!!')
							.setDescription(
								`<@${move.user.id}> の頭部が吹き飛びました。\n\n🏆 **勝利者** ${winnerUser}`
							)
							.addFields({
								name: '獲得/損失',
								value: `${winnerUser} は ${ROMECOIN_EMOJI}${bet} を獲得\n${loserUser} は ${ROMECOIN_EMOJI}${bet} を失いました`,
								inline: false,
							})
							.setColor(0x880000)
							.setImage('https://media1.tenor.com/m/X215c2D-i_0AAAAC/gun-gunshot.gif');

						await move.update({ content: null, embeds: [deathEmbed], components: [] });
						gameCollector.stop('death');

						// 死亡処理
						const loserId = move.user.id;
						const winnerId = loserId === userId ? actualOpponentUser.id : userId;

						// ゲーム終了：進行状況をクリア
						clearUserGame(userId);
						clearUserGame(actualOpponentUser.id);

						const loserMember = await interaction.guild.members.fetch(loserId).catch(() => null);
						const winnerMember = await interaction.guild.members.fetch(winnerId).catch(() => null);

						// ロメコインのやり取り（ログ付き）
						await updateRomecoin(
							winnerId,
							(current) => Math.round((current || 0) + bet),
							{
								log: true,
								client: interaction.client,
								reason: `ロシアンルーレット勝利: ${loserUser.tag} との対戦`,
								metadata: {
									targetUserId: loserId,
									commandName: 'duel_russian',
								},
							}
						);
						await updateRomecoin(
							loserId,
							(current) => Math.round((current || 0) - bet),
							{
								log: true,
								client: interaction.client,
								reason: `ロシアンルーレット敗北: ${winnerUser.tag} との対戦`,
								metadata: {
									targetUserId: winnerId,
									commandName: 'duel_russian',
								},
							}
						);

						// ペナルティ: タイムアウト
						if (loserMember) {
							const timeoutMs = 10 * 60 * 1000; // 10分

							if (loserMember.moderatable) {
								try {
									await loserMember.timeout(timeoutMs, 'Russian Roulette Death').catch(() => {});

									// タイムアウト適用時にメッセージを送信
									try {
										await interaction.channel.send(`⚰️ ${loserMember} は闇に葬られました...`);
									} catch (e) {
										console.error('メッセージ送信エラー:', e);
									}
								} catch (e) {
									console.error('タイムアウト適用エラー:', e);
								}
							}
						}

						// 戦績記録
						if (winnerMember) {
							const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
							let duelData = {};
							if (fs.existsSync(DATA_FILE)) {
								try {
									duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
								} catch (e) {
									console.error('決闘データ読み込みエラー:', e);
								}
							}

							// データ引き継ぎ（ID → Notion名）
							await migrateData(winnerId, duelData);

							// 勝者のデータを更新
							await updateData(winnerId, duelData, (current) => {
								const data = current || { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
								data.wins++;
								data.streak++;
								if (data.streak > data.maxStreak) {
									data.maxStreak = data.streak;
								}
								return data;
							});

							try {
								fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2));
								// Memory storeに保存
								persistence.save(client).catch((err) => console.error('Memory store保存エラー:', err));
							} catch (e) {
								console.error('決闘データ書き込みエラー:', e);
							}

							// 表示用にデータを取得
							const winnerData = await getData(winnerId, duelData, {
								wins: 0,
								losses: 0,
								streak: 0,
								maxStreak: 0,
							});
							interaction.channel.send(
								`✨ **勝利者** <@${winnerId}> は死地を潜り抜けました！ (現在 ${winnerData.streak}連勝)`
							);
						}

						return;
					} else {
						// ミス - 次のターン
						state.current++;
						state.turn = state.turn === userId ? actualOpponentUser.id : userId;
						const nextEmbed = new EmbedBuilder()
							.setTitle('💨 Click...')
							.setDescription('セーフです。')
							.addFields(
								{ name: '次のターン', value: `<@${state.turn}>`, inline: true },
								{ name: 'シリンダー', value: `${state.current + 1}/6`, inline: true }
							)
							.setColor(0x57f287);

						await move.update({ content: null, embeds: [nextEmbed], components: [triggerRow] });
					}
				});

				gameCollector.on('end', async (c, reason) => {
					if (reason !== 'death') {
						interaction.channel.send('⏰ ゲームは時間切れで中断されました。');
						
						// ロメコイン返却処理
						try {
							await updateRomecoin(
								userId,
								(current) => Math.round((current || 0) + bet),
								{
									log: true,
									client: interaction.client,
									reason: `ロシアンルーレット無効試合: タイムアウトによる返却`,
									metadata: {
										targetUserId: actualOpponentUser.id,
										commandName: 'duel_russian',
									},
								}
							);
							await updateRomecoin(
								actualOpponentUser.id,
								(current) => Math.round((current || 0) + bet),
								{
									log: true,
									client: interaction.client,
									reason: `ロシアンルーレット無効試合: タイムアウトによる返却`,
									metadata: {
										targetUserId: userId,
										commandName: 'duel_russian',
									},
								}
							);
							await interaction.channel.send(
								`💰 無効試合のため、両プレイヤーに ${ROMECOIN_EMOJI}${bet} を返却しました。`
							);
						} catch (e) {
							console.error('ロメコイン返却エラー:', e);
						}
						
						// タイムアウト時も進行状況をクリア
						clearUserGame(userId);
						clearUserGame(actualOpponentUser.id);
					}
				});
			});

			collector.on('end', async (collected) => {
				if (collected.size === 0) {
					try {
						await interaction.editReply({
							content: '⏰ 時間切れでロシアンルーレットがキャンセルされました。',
							components: [],
							embeds: [],
						});
					} catch (e) {
						// インタラクションがタイムアウトしている場合はチャンネルに送信
						if (e.code === 10062 || e.code === 40060) {
							await interaction.channel.send('⏰ 時間切れでロシアンルーレットがキャンセルされました。').catch(() => {});
						}
					}
					// タイムアウト時も進行状況をクリア
					clearUserGame(userId);
					if (opponentUser) {
						clearUserGame(opponentUser.id);
					}
				}
			});
		} catch (error) {
			console.error('ロシアンルーレットコマンドエラー:', error);
			if (interaction.deferred || interaction.replied) {
				return interaction.editReply({ content: 'エラーが発生しました。' });
			}
			return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
		}
		return;
	}

	// duel_ranking コマンド
	if (interaction.commandName === 'duel_ranking') {
		try {
			const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');

			if (!fs.existsSync(DATA_FILE)) {
				return interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setTitle('📊 ランキング')
							.setDescription('データがまだありません。')
							.setColor(0x2f3136),
					],
					ephemeral: true,
				});
			}

			let duelData = {};
			try {
				duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
			} catch (e) {
				console.error('ランキングデータ読み込みエラー:', e);
				return interaction.reply({ content: 'データ読み込みエラー', ephemeral: true });
			}

			// オブジェクトを配列に変換
			const players = Object.entries(duelData).map(([id, data]) => ({ id, ...data }));

			// Top Wins
			const topWins = [...players].sort((a, b) => b.wins - a.wins).slice(0, 5);
			// Top Streaks (Current)
			const topStreaks = [...players].sort((a, b) => b.streak - a.streak).slice(0, 5);
			// Top Losses
			const topLosses = [...players].sort((a, b) => (b.losses || 0) - (a.losses || 0)).slice(0, 5);

			const buildLeaderboard = (list, type) => {
				if (list.length === 0) return 'なし';
				return list
					.map((p, i) => {
						const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
						let val;
						if (type === 'wins') {
							val = `${p.wins || 0}勝`;
						} else if (type === 'losses') {
							val = `${p.losses || 0}敗`;
						} else {
							val = `${p.streak || 0}連勝`;
						}
						return `${medal} <@${p.id}> (**${val}**)`;
					})
					.join('\n');
			};

			const embed = new EmbedBuilder()
				.setTitle('🏆 決闘ランキング')
				.setColor(0xffd700)
				.addFields(
					{ name: '🔥 勝利数 Top 5', value: buildLeaderboard(topWins, 'wins'), inline: true },
					{ name: '💀 敗北数 Top 5', value: buildLeaderboard(topLosses, 'losses'), inline: true },
					{ name: '⚡ 現在の連勝記録 Top 5', value: buildLeaderboard(topStreaks, 'streak'), inline: true }
				)
				.setFooter({ text: '※ 通常決闘とロシアンルーレットの合算戦績です' })
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} catch (error) {
			console.error('ランキングコマンドエラー:', error);
			if (interaction.deferred || interaction.replied) {
				return interaction.editReply({ content: 'エラーが発生しました。' });
			}
			return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
		}
		return;
	}

	// ショップコマンド
	if (interaction.commandName === 'shop') {
		try {
			// 購入履歴を確認
			let shopData = {};
			try {
				const shopDataFile = path.join(__dirname, '../data/shop_data.json');
				if (fs.existsSync(shopDataFile)) {
					shopData = JSON.parse(fs.readFileSync(shopDataFile, 'utf8'));
				}
			} catch (e) {
				console.error('[ショップ] 購入履歴読み込みエラー:', e);
			}

			const userId = interaction.user.id;
			const hasLogViewerRole = shopData[userId] && shopData[userId]['log_viewer_role'];
			const hasEmojiCreatorRole = shopData[userId] && shopData[userId]['emoji_creator_role'];

			// 商品選択セレクトメニュー
			// デフォルト値は最大1つまでしか設定できないため、購入済み商品はデフォルトにしない
			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('shop_select_item')
				.setPlaceholder('購入する商品を選択してください')
				.addOptions(
					new StringSelectMenuOptionBuilder()
						.setLabel('ログ閲覧権限ロール')
						.setDescription(`${ROMECOIN_EMOJI}25,000 - ロメダの管理ログ・廃部ログ・過去ログが読めるようになります${hasLogViewerRole ? ' (購入済み)' : ''}`)
						.setValue('log_viewer_role')
						.setEmoji('📜')
						.setDefault(false), // デフォルトは設定しない
					new StringSelectMenuOptionBuilder()
						.setLabel('絵文字作成権ロール')
						.setDescription(`${ROMECOIN_EMOJI}30,000 - サーバーで絵文字を作成できるようになります${hasEmojiCreatorRole ? ' (購入済み)' : ''}`)
						.setValue('emoji_creator_role')
						.setEmoji('🎨')
						.setDefault(false) // デフォルトは設定しない
				);

			const row = new ActionRowBuilder().addComponents(selectMenu);

			const embed = new EmbedBuilder()
				.setTitle('🛒 ロメコインショップ')
				.setColor(0x00ff00)
				.setDescription('ロメコインを使って特別な権限やアイテムを購入できます！\n\n下のセレクトメニューから購入する商品を選択してください。')
				.addFields(
					{
						name: '📜 ログ閲覧権限ロール',
						value: `<@&${SHOP_LOG_VIEWER_ROLE_ID}>\n\n**価格:** ${ROMECOIN_EMOJI}25,000\n**説明:** ロメダの管理ログ・廃部ログ・過去ログが読めるようになります。\n**注意:** 一回の買い切りです。${hasLogViewerRole ? '\n\n✅ **購入済み**' : ''}`,
						inline: false,
					},
					{
						name: '🎨 絵文字作成権ロール',
						value: `<@&${SHOP_EMOJI_CREATOR_ROLE_ID}>\n\n**価格:** ${ROMECOIN_EMOJI}30,000\n**説明:** サーバーで絵文字を作成できるようになります。\n**注意:** 一回の買い切りです。${hasEmojiCreatorRole ? '\n\n✅ **購入済み**' : ''}`,
						inline: false,
					}
				)
				.setFooter({ text: '※ 商品は一度購入すると再度購入できません' })
				.setTimestamp();

			await interaction.reply({ embeds: [embed], components: [row] });
		} catch (error) {
			console.error('ショップコマンドエラー:', error);
			if (interaction.deferred || interaction.replied) {
				return interaction.editReply({ content: 'エラーが発生しました。' });
			}
			return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
		}
		return;
	}

	// バックパックコマンド（購入済み商品を表示）
	if (interaction.commandName === 'backpack') {
		try {
			// 購入履歴を確認
			let shopData = {};
			try {
				const shopDataFile = path.join(__dirname, '../data/shop_data.json');
				if (fs.existsSync(shopDataFile)) {
					shopData = JSON.parse(fs.readFileSync(shopDataFile, 'utf8'));
				}
			} catch (e) {
				console.error('[バックパック] 購入履歴読み込みエラー:', e);
			}

			const userId = interaction.user.id;
			const userPurchases = shopData[userId] || {};

			// 商品情報
			const items = {
				log_viewer_role: {
					name: 'ログ閲覧権限ロール',
					roleId: SHOP_LOG_VIEWER_ROLE_ID,
				},
				emoji_creator_role: {
					name: '絵文字作成権ロール',
					roleId: SHOP_EMOJI_CREATOR_ROLE_ID,
				},
			};

			const purchasedItems = [];
			for (const [itemId, purchaseData] of Object.entries(userPurchases)) {
				if (items[itemId]) {
					const purchaseDate = new Date(purchaseData.purchasedAt);
					purchasedItems.push({
						name: items[itemId].name,
						roleId: items[itemId].roleId,
						purchasedAt: purchaseDate,
					});
				}
			}

			if (purchasedItems.length === 0) {
				const embed = new EmbedBuilder()
					.setTitle('🎒 バックパック')
					.setColor(0x99aab5)
					.setDescription('購入済みの商品はありません。\n`/shop`で商品を確認できます。')
					.setTimestamp();

				return interaction.reply({ embeds: [embed], ephemeral: true });
			}

			const itemsList = purchasedItems
				.map((item) => {
					const dateStr = item.purchasedAt.toLocaleString('ja-JP');
					return `📦 **${item.name}**\n<@&${item.roleId}>\n購入日: ${dateStr}`;
				})
				.join('\n\n');

			const embed = new EmbedBuilder()
				.setTitle('🎒 バックパック')
				.setColor(0x00ff00)
				.setDescription(`購入済みの商品 (${purchasedItems.length}件)\n\n${itemsList}`)
				.setTimestamp();

			await interaction.reply({ embeds: [embed], ephemeral: true });
		} catch (error) {
			console.error('バックパックコマンドエラー:', error);
			if (interaction.deferred || interaction.replied) {
				return interaction.editReply({ content: 'エラーが発生しました。' });
			}
			return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
		}
		return;
	}

	// セレクトメニューインタラクション処理
	if (interaction.isStringSelectMenu()) {
		// ショップ商品選択
		if (interaction.customId === 'shop_select_item') {
			try {
				const itemId = interaction.values[0];
				const userId = interaction.user.id;
				const guildId = interaction.guild.id;

				// サーバー間クールダウン（30秒）
				const cooldownKey = `shop_buy_${guildId}`;
				const lastUsed = shopBuyCooldowns.get(cooldownKey) || 0;
				const cooldownTime = 30 * 1000; // 30秒
				const elapsed = Date.now() - lastUsed;

				if (elapsed < cooldownTime) {
					const remainSec = Math.ceil((cooldownTime - elapsed) / 1000);
					return interaction.reply({
						content: `⏰ サーバー間クールダウン中です（残り${remainSec}秒）`,
						ephemeral: true,
					});
				}

				// 購入履歴を確認
				let shopData = {};
				try {
					const shopDataFile = path.join(__dirname, '../data/shop_data.json');
					if (fs.existsSync(shopDataFile)) {
						shopData = JSON.parse(fs.readFileSync(shopDataFile, 'utf8'));
					}
				} catch (e) {
					console.error('[ショップ] 購入履歴読み込みエラー:', e);
				}

				// 商品情報
				const items = {
					log_viewer_role: {
						id: 'log_viewer_role',
						name: 'ログ閲覧権限ロール',
						price: 25000,
						roleId: SHOP_LOG_VIEWER_ROLE_ID,
						description: 'ロメダの管理ログ・廃部ログ・過去ログが読めるようになります。',
					},
					emoji_creator_role: {
						id: 'emoji_creator_role',
						name: '絵文字作成権ロール',
						price: 30000,
						roleId: SHOP_EMOJI_CREATOR_ROLE_ID,
						description: 'サーバーで絵文字を作成できるようになります。',
					},
				};

				const item = items[itemId];
				if (!item) {
					return interaction.reply({
						content: '❌ 無効な商品IDです。',
						ephemeral: true,
					});
				}

				// 既に購入済みかチェック
				if (!shopData[userId]) {
					shopData[userId] = {};
				}
				if (shopData[userId][item.id]) {
					return interaction.reply({
						content: `❌ この商品は既に購入済みです。`,
						ephemeral: true,
					});
				}

				// ロメコイン残高を確認
				const balance = await getRomecoin(userId);
				if (balance < item.price) {
					return interaction.reply({
						content: `❌ ロメコインが不足しています。\n必要: ${ROMECOIN_EMOJI}${item.price.toLocaleString()}\n所持: ${ROMECOIN_EMOJI}${balance.toLocaleString()}`,
						ephemeral: true,
					});
				}

				// 確認Embed
				const confirmEmbed = new EmbedBuilder()
					.setTitle('⚠️ 購入確認')
					.setColor(0xffa500)
					.setDescription(`**${item.name}** を購入しますか？`)
					.addFields(
						{ name: '価格', value: `${ROMECOIN_EMOJI}${item.price.toLocaleString()}`, inline: true },
						{ name: '現在の残高', value: `${ROMECOIN_EMOJI}${balance.toLocaleString()}`, inline: true },
						{ name: '購入後の残高', value: `${ROMECOIN_EMOJI}${(balance - item.price).toLocaleString()}`, inline: true },
						{ name: '説明', value: item.description, inline: false }
					)
					.setFooter({ text: '※ この商品は一度購入すると再度購入できません' })
					.setTimestamp();

				const confirmButton = new ButtonBuilder()
					.setCustomId(`shop_confirm_${item.id}`)
					.setLabel('購入を確定')
					.setStyle(ButtonStyle.Success)
					.setEmoji('✅');

				const cancelButton = new ButtonBuilder()
					.setCustomId('shop_cancel')
					.setLabel('キャンセル')
					.setStyle(ButtonStyle.Danger)
					.setEmoji('❌');

				const confirmRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

				await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], ephemeral: true });
			} catch (error) {
				console.error('ショップ商品選択エラー:', error);
				if (interaction.deferred || interaction.replied) {
					return interaction.editReply({ content: 'エラーが発生しました。' });
				}
				return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
			}
			return;
		}
	}

	// ボタンインタラクション処理
	if (interaction.isButton()) {
		// 購入確認ボタン（汎用 - shop_confirm_*）
		if (interaction.customId.startsWith('shop_confirm_')) {
			try {
				const itemId = interaction.customId.replace('shop_confirm_', '');
				const userId = interaction.user.id;
				const guildId = interaction.guild.id;

				// サーバー間クールダウン（30秒）
				const cooldownKey = `shop_buy_${guildId}`;
				const lastUsed = shopBuyCooldowns.get(cooldownKey) || 0;
				const cooldownTime = 30 * 1000; // 30秒
				const elapsed = Date.now() - lastUsed;

				if (elapsed < cooldownTime) {
					const remainSec = Math.ceil((cooldownTime - elapsed) / 1000);
					return interaction.reply({
						content: `⏰ サーバー間クールダウン中です（残り${remainSec}秒）`,
						ephemeral: true,
					});
				}

				// 購入履歴を確認
				let shopData = {};
				try {
					const shopDataFile = path.join(__dirname, '../data/shop_data.json');
					if (fs.existsSync(shopDataFile)) {
						shopData = JSON.parse(fs.readFileSync(shopDataFile, 'utf8'));
					}
				} catch (e) {
					console.error('[ショップ] 購入履歴読み込みエラー:', e);
				}

				// 商品情報
				const items = {
					log_viewer_role: {
						id: 'log_viewer_role',
						name: 'ログ閲覧権限ロール',
						price: 25000,
						roleId: SHOP_LOG_VIEWER_ROLE_ID,
						description: 'ロメダの管理ログ・廃部ログ・過去ログが読めるようになります。',
					},
					emoji_creator_role: {
						id: 'emoji_creator_role',
						name: '絵文字作成権ロール',
						price: 30000,
						roleId: SHOP_EMOJI_CREATOR_ROLE_ID,
						description: 'サーバーで絵文字を作成できるようになります。',
					},
				};

				const item = items[itemId];
				if (!item) {
					return interaction.reply({
						content: '❌ 無効な商品IDです。',
						ephemeral: true,
					});
				}

				// 既に購入済みかチェック
				if (!shopData[userId]) {
					shopData[userId] = {};
				}
				if (shopData[userId][item.id]) {
					return interaction.reply({
						content: `❌ この商品は既に購入済みです。`,
						ephemeral: true,
					});
				}

				// ロメコイン残高を確認
				const balance = await getRomecoin(userId);
				if (balance < item.price) {
					return interaction.reply({
						content: `❌ ロメコインが不足しています。\n必要: ${ROMECOIN_EMOJI}${item.price.toLocaleString()}\n所持: ${ROMECOIN_EMOJI}${balance.toLocaleString()}`,
						ephemeral: true,
					});
				}

				// ロールを付与
				const member = await interaction.guild.members.fetch(userId).catch(() => null);
				if (!member) {
					return interaction.reply({
						content: '❌ メンバー情報を取得できませんでした。',
						ephemeral: true,
					});
				}

				// 既にロールを持っているかチェック
				if (member.roles.cache.has(item.roleId)) {
					// 既にロールを持っている場合は購入履歴に記録するだけ
					shopData[userId][item.id] = {
						purchasedAt: Date.now(),
						alreadyHadRole: true,
					};
				} else {
					// ロールを付与
					await member.roles.add(item.roleId);
					shopData[userId][item.id] = {
						purchasedAt: Date.now(),
						alreadyHadRole: false,
					};
				}

				// 購入履歴を保存
				try {
					const shopDataFile = path.join(__dirname, '../data/shop_data.json');
					const dataDir = path.dirname(shopDataFile);
					if (!fs.existsSync(dataDir)) {
						fs.mkdirSync(dataDir, { recursive: true });
					}
					fs.writeFileSync(shopDataFile, JSON.stringify(shopData, null, 2), 'utf8');
				} catch (e) {
					console.error('[ショップ] 購入履歴保存エラー:', e);
				}

				// ユーザーのロメコインを減額（ログ付き）
				const previousBalance = balance;
				await updateRomecoin(
					userId,
					(current) => Math.round((current || 0) - item.price),
					{
						log: true,
						client: client,
						reason: `ショップ購入: ${item.name}`,
						metadata: {
							commandName: 'shop_buy',
							itemId: item.id,
						},
					}
				);
				const newBalance = await getRomecoin(userId);

				// クロスロイドのロメコインを増額（ログ付き）
				const botUserId = client.user.id;
				const botPreviousBalance = await getRomecoin(botUserId);
				await updateRomecoin(
					botUserId,
					(current) => Math.round((current || 0) + item.price),
					{
						log: true,
						client: client,
						reason: `ショップ収益: ${item.name} (購入者: ${interaction.user.tag})`,
						metadata: {
							commandName: 'shop_revenue',
							itemId: item.id,
							buyerId: userId,
						},
					}
				);
				const botNewBalance = await getRomecoin(botUserId);

				// クールダウンを更新
				shopBuyCooldowns.set(cooldownKey, Date.now());

				// 成功メッセージ
				const successEmbed = new EmbedBuilder()
					.setTitle('✅ 購入完了')
					.setColor(0x00ff00)
					.setDescription(`**${item.name}** の購入が完了しました！`)
					.addFields(
						{ name: '支払額', value: `${ROMECOIN_EMOJI}${item.price.toLocaleString()}`, inline: true },
						{ name: '購入前の残高', value: `${ROMECOIN_EMOJI}${previousBalance.toLocaleString()}`, inline: true },
						{ name: '購入後の残高', value: `${ROMECOIN_EMOJI}${newBalance.toLocaleString()}`, inline: true }
					)
					.setFooter({ text: '※ この商品は一度購入すると再度購入できません' })
					.setTimestamp();

				await interaction.update({ embeds: [successEmbed], components: [] });
			} catch (error) {
				console.error('ショップ購入確認エラー:', error);
				if (interaction.deferred || interaction.replied) {
					return interaction.editReply({ content: 'エラーが発生しました。' });
				}
				return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
			}
			return;
		}

		// キャンセルボタン
		if (interaction.customId === 'shop_cancel') {
			try {
				const cancelEmbed = new EmbedBuilder()
					.setTitle('❌ 購入をキャンセルしました')
					.setColor(0xff0000)
					.setDescription('購入処理をキャンセルしました。')
					.setTimestamp();

				await interaction.update({ embeds: [cancelEmbed], components: [] });
			} catch (error) {
				console.error('ショップキャンセルエラー:', error);
				if (interaction.deferred || interaction.replied) {
					return interaction.editReply({ content: 'エラーが発生しました。' });
				}
				return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
			}
			return;
		}
	}

	// 麻雀コマンド
	if (interaction.isChatInputCommand()) {
		if (interaction.commandName === 'mahjong_create') {
			const mahjong = require('../features/mahjong');
			await mahjong.createTable(interaction, client);
			return;
		}

		if (interaction.commandName === 'mahjong_result') {
			const mahjong = require('../features/mahjong');
			await mahjong.handleResult(interaction, client);
			return;
		}

		if (interaction.commandName === 'mahjong_edit') {
			const mahjong = require('../features/mahjong');
			await mahjong.handleEdit(interaction, client);
			return;
		}
	}

}

// 30分ごとのクリーンアップ
setInterval(() => {
	const oneHourAgo = Date.now() - 60 * 60 * 1000;
	for (const [userId, lastUsed] of anonymousCooldowns.entries()) {
		if (lastUsed < oneHourAgo) anonymousCooldowns.delete(userId);
	}
	for (const [userId, lastBump] of bumpCooldowns.entries()) {
		if (lastBump < oneHourAgo) bumpCooldowns.delete(userId);
	}
	for (const [key, lastUsed] of shopBuyCooldowns.entries()) {
		if (lastUsed < oneHourAgo) shopBuyCooldowns.delete(key);
	}
	for (const [id] of processingCommands) {
		processingCommands.delete(id);
	}
}, 30 * 60 * 1000);

module.exports = { handleCommands };
