const fs = require('fs');
const { DATABASE_CHANNEL_ID, RADIATION_ROLE_ID, ROMECOIN_LOG_CHANNEL_ID } = require('../constants');
const { checkAdmin } = require('../utils');
const { getData, updateData, migrateData } = require('./dataAccess');
const notionManager = require('./notion');
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { isUserInGame, setUserGame, clearUserGame } = require('../utils');
const crypto = require('crypto');

// ロメコインデータ
let romecoin_data = new Object();
// クールダウン用配列
let message_cooldown_users = new Array();
let reaction_cooldown_users = new Array();
// じゃんけん進行データ
let janken_progress_data = new Object();
// ロメコインランキングのサーバー間クールダウン（30秒）
let romecoin_ranking_cooldowns = new Map();
// ロメコイン絵文字
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';
// Discordクライアント（ログ送信用）
let discordClient = null;

const RSPEnum = Object.freeze({
	rock: 'グー',
	scissors: 'チョキ',
	paper: 'パー',
});

async function clientReady(client) {
	// クライアントを保存（ログ送信用）
	discordClient = client;

	// DBからデータを取得
	const db_channel = await client.channels.fetch(DATABASE_CHANNEL_ID);
	const message = (await db_channel.messages.fetch({ limit: 1, cache: false })).first();
	message.attachments.forEach(async (attachment) => {
		if (attachment.name === 'romecoin_data.json') {
			const response = await fetch(attachment.url);
			const data = await response.text();
			romecoin_data = JSON.parse(data);
		}
	});

	// 60秒ごとにデータを送信
	setInterval(async () => {
		fs.writeFile('./.tmp/romecoin_data.json', JSON.stringify(romecoin_data), (err) => {
			if (err) {
				throw err;
			}
		});

		await db_channel.send({ files: ['./.tmp/romecoin_data.json'] });
	}, 60000);

	// 10秒ごとにクールダウンをリセット
	setInterval(async () => {
		message_cooldown_users = new Array();
		reaction_cooldown_users = new Array();
	}, 10000);
}

async function interactionCreate(interaction) {
	if (interaction.isChatInputCommand()) {
		if (interaction.commandName === 'romecoin') {
			const user = interaction.options.getUser('user')
				? interaction.options.getUser('user').id
				: interaction.user.id;
			const romecoin = await getData(user, romecoin_data, 0);
			interaction.reply({
				content: `<@${user}>の現在の所持ロメコイン: ${ROMECOIN_EMOJI}${romecoin}`,
				ephemeral: true,
			});
		} else if (interaction.commandName === 'romecoin_ranking') {
			// サーバー間クールダウンチェック（30秒）
			const guildId = interaction.guild?.id || 'dm';
			const now = Date.now();
			const lastUsed = romecoin_ranking_cooldowns.get(guildId) || 0;
			const COOLDOWN_MS = 30 * 1000; // 30秒

			if (now - lastUsed < COOLDOWN_MS) {
				const remainSec = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
				return interaction.reply({
					content: `⏳ クールダウン中です（残り${remainSec}秒）`,
					ephemeral: true,
				});
			}

			// クールダウンを更新
			romecoin_ranking_cooldowns.set(guildId, now);

			// データを配列に変換（Notion名の場合はDiscord IDを取得）
			// 黒須銀行（クロスロイド）を除外
			const botUserId = interaction.client.user.id;
			const sortedData = await Promise.all(
				Object.entries(romecoin_data)
					.filter(([key, value]) => {
						// クロスロイドのIDを除外
						if (key === botUserId) return false;
						// Notion名の場合はDiscord IDを確認
						if (!/^\d+$/.test(key)) {
							return true; // 後でDiscord IDを確認
						}
						return key !== botUserId;
					})
					.map(async ([key, value]) => {
						const isNotionName = !/^\d+$/.test(key);
						let discordId = key;

						if (isNotionName) {
							discordId = (await notionManager.getDiscordId(key)) || key;
							// クロスロイドの場合は除外
							if (discordId === botUserId) return null;
						}

						return { key, discordId, displayName: isNotionName ? key : null, value };
					})
			);
			
			// nullを除外
			const filteredData = sortedData.filter(item => item !== null);

			filteredData.sort((a, b) => b.value - a.value);

			// ページネーション用のデータ準備
			const ITEMS_PER_PAGE = 10;
			const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
			let currentPage = 0;

			// ランキング表示用の関数
			const buildRankingEmbed = (page) => {
				const startIndex = page * ITEMS_PER_PAGE;
				const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredData.length);
				const pageData = filteredData.slice(startIndex, endIndex);

				let rankingText = '';
				for (let i = 0; i < pageData.length; i++) {
					const rank = startIndex + i + 1;
					const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
					const display = pageData[i].displayName
						? `${pageData[i].displayName} (<@${pageData[i].discordId}>)`
						: `<@${pageData[i].discordId}>`;
					rankingText += `${medal} ${display} - ${ROMECOIN_EMOJI}${pageData[i].value}\n`;
				}

				if (rankingText === '') {
					rankingText = 'データがありません';
				}

				const embed = new EmbedBuilder()
					.setTitle('🏆 ROMECOINランキング')
					.setDescription(rankingText)
					.setColor(0xffd700)
					.setFooter({ text: `ページ ${page + 1}/${totalPages} | 総登録者数: ${filteredData.length}人` })
					.setTimestamp();

				return embed;
			};

			// ボタン作成
			const buildButtons = (page, userId) => {
				const row = new ActionRowBuilder();

				const prevButton = new ButtonBuilder()
					.setCustomId(`romecoin_ranking_prev_${page}_${userId}`)
					.setLabel('前へ')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === 0);

				const nextButton = new ButtonBuilder()
					.setCustomId(`romecoin_ranking_next_${page}_${userId}`)
					.setLabel('次へ')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page >= totalPages - 1);

				row.addComponents(prevButton, nextButton);
				return row;
			};

			// 初回表示
			await interaction.reply({
				embeds: [buildRankingEmbed(currentPage)],
				components: totalPages > 1 ? [buildButtons(currentPage, interaction.user.id)] : [],
				ephemeral: false,
			});
		} else if (interaction.commandName === 'janken') {
			// 既に応答済みの場合は処理をスキップ
			if (interaction.replied || interaction.deferred) {
				return;
			}

			const bet = interaction.options.getInteger('bet') ? interaction.options.getInteger('bet') : 100;
			if (bet < 100) {
				if (!interaction.replied && !interaction.deferred) {
					return interaction.reply({
						content: 'ベットは100以上の整数で指定してください',
						flags: [MessageFlags.Ephemeral],
					}).catch(() => {});
				}
				return;
			}

			// 重複実行チェック（最初にチェック）
			if (isUserInGame(interaction.user.id)) {
				if (!interaction.replied && !interaction.deferred) {
					const errorEmbed = new EmbedBuilder()
						.setTitle('❌ エラー')
						.setDescription(
							'あなたは現在他のゲーム（duel/duel_russian/janken）を実行中です。同時に実行できるのは1つだけです。'
						)
						.setColor(0xff0000);
					return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
				}
				return;
			}

			// 即座にロックをかける（重複対戦を防ぐ）
			const tempProgressId = `temp_janken_${interaction.user.id}_${Date.now()}`;
			setUserGame(interaction.user.id, 'janken', tempProgressId);

			try {
				// 被爆ロールチェック：被爆ロールがついている人は対戦コマンドを実行できない
				if (interaction.member.roles.cache.has(RADIATION_ROLE_ID)) {
					clearUserGame(interaction.user.id);
					if (!interaction.replied && !interaction.deferred) {
						const errorEmbed = new EmbedBuilder()
							.setTitle('❌ エラー')
							.setDescription('被爆ロールがついているため、対戦コマンドを実行できません。')
							.setColor(0xff0000);
						return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
					}
					return;
				}

			if (
				!Object.values(janken_progress_data).some(
					(data) =>
						(data.user && data.user.id === interaction.user.id) ||
						(data.opponent && data.opponent.id === interaction.user.id)
				)
			) {
				const opponent = interaction.options.getUser('opponent');
				if ((await getData(interaction.user.id, romecoin_data, 0)) >= bet) {
					const progress_id = crypto.randomUUID();
					if (opponent) {
						// クロスロイドと対戦
						if (opponent.id === interaction.client.user.id) {
							// クロスロイドのロメコイン残高をチェック
							const botRomecoin = await getData(interaction.client.user.id, romecoin_data, 0);
							if (botRomecoin < bet) {
								clearUserGame(interaction.user.id);
								if (!interaction.replied && !interaction.deferred) {
									const errorEmbed = new EmbedBuilder()
										.setTitle('❌ エラー')
										.setDescription('クロスロイドのロメコインが不足しています')
										.addFields(
											{
												name: 'クロスロイドの現在の所持ロメコイン',
												value: `${ROMECOIN_EMOJI}${botRomecoin}`,
												inline: true,
											},
											{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
										)
										.setColor(0xff0000);
									return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
								}
								return;
							}
							
							// 手選択ボタンを表示
							const rockButton = new ButtonBuilder()
								.setCustomId(`janken_rock_${progress_id}`)
								.setLabel('グー')
								.setEmoji('✊')
								.setStyle(ButtonStyle.Primary);
							const scissorsButton = new ButtonBuilder()
								.setCustomId(`janken_scissors_${progress_id}`)
								.setLabel('チョキ')
								.setEmoji('✌️')
								.setStyle(ButtonStyle.Success);
							const paperButton = new ButtonBuilder()
								.setCustomId(`janken_paper_${progress_id}`)
								.setLabel('パー')
								.setEmoji('✋')
								.setStyle(ButtonStyle.Danger);
							const row = new ActionRowBuilder().addComponents(rockButton, scissorsButton, paperButton);

							const embed = new EmbedBuilder()
								.setTitle('✂️ じゃんけん勝負')
								.setDescription(
									`${opponent}\n${interaction.user} からじゃんけん勝負を申し込まれました。`
								)
								.addFields(
									{ name: 'ルール', value: 'グー・チョキ・パーで勝負', inline: true },
									{ name: 'ベット', value: `${ROMECOIN_EMOJI}${bet}`, inline: true },
									{ name: '注意', value: '受諾後、キャンセル不可', inline: false }
								)
								.setColor(0xffa500)
								.setThumbnail(interaction.user.displayAvatarURL());

							if (interaction.replied || interaction.deferred) {
								clearUserGame(interaction.user.id);
								return;
							}

							const replyMessage = await interaction.reply({
								content: `${opponent}`,
								embeds: [embed],
								components: [row],
								fetchReply: true,
							}).catch((error) => {
								clearUserGame(interaction.user.id);
								if (error.code !== 10062 && error.code !== 40060) {
									console.error('[Janken] 応答エラー:', error);
								}
								return null;
							});

							if (!replyMessage) {
								return;
							}
							janken_progress_data[progress_id] = {
								user: interaction.user,
								opponent: opponent,
								bet: bet,
								timeout_id: null,
								user_hand: null,
								opponent_hand: null, // ユーザーが手を選ぶタイミングでランダムに決定
								status: 'selecting_hands',
								message: replyMessage,
							};
						}
						// 他ユーザーと対戦
						else if (opponent.id !== interaction.user.id && !opponent.bot) {
							// 被爆ロールチェック：対戦相手が被爆ロールを持っている場合は挑戦できない
							const opponentMember = await interaction.guild.members.fetch(opponent.id).catch(() => null);
							if (opponentMember && opponentMember.roles.cache.has(RADIATION_ROLE_ID)) {
								clearUserGame(interaction.user.id);
								if (!interaction.replied && !interaction.deferred) {
									const errorEmbed = new EmbedBuilder()
										.setTitle('❌ エラー')
										.setDescription('対戦相手が被爆ロールを持っているため、挑戦できません。')
										.setColor(0xff0000);
									return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
								}
								return;
							}

							if ((await getData(opponent.id, romecoin_data, 0)) >= bet) {
								// 対戦相手の手選択ボタンを表示
								const rockButton = new ButtonBuilder()
									.setCustomId(`janken_rock_${progress_id}`)
									.setLabel('グー')
									.setEmoji('✊')
									.setStyle(ButtonStyle.Primary);
								const scissorsButton = new ButtonBuilder()
									.setCustomId(`janken_scissors_${progress_id}`)
									.setLabel('チョキ')
									.setEmoji('✌️')
									.setStyle(ButtonStyle.Success);
								const paperButton = new ButtonBuilder()
									.setCustomId(`janken_paper_${progress_id}`)
									.setLabel('パー')
									.setEmoji('✋')
									.setStyle(ButtonStyle.Danger);
								const row = new ActionRowBuilder().addComponents(
									rockButton,
									scissorsButton,
									paperButton
								);

								const embed = new EmbedBuilder()
									.setTitle('✂️ じゃんけん勝負')
									.setDescription(
										`${opponent}\n${interaction.user} からじゃんけん勝負を申し込まれました。`
									)
									.addFields(
										{ name: 'ルール', value: 'グー・チョキ・パーで勝負', inline: true },
										{ name: 'ベット', value: `${ROMECOIN_EMOJI}${bet}`, inline: true },
										{ name: '注意', value: '受諾後、キャンセル不可', inline: false }
									)
									.setColor(0xffa500)
									.setThumbnail(interaction.user.displayAvatarURL());

								if (interaction.replied || interaction.deferred) {
									clearUserGame(interaction.user.id);
									return;
								}

								const select_message = await interaction.reply({
									content: `${opponent}`,
									embeds: [embed],
									components: [row],
									fetchReply: true,
								}).catch((error) => {
									clearUserGame(interaction.user.id);
									if (error.code !== 10062 && error.code !== 40060) {
										console.error('[Janken] 応答エラー:', error);
									}
									return null;
								});

								if (!select_message) {
									return;
								}

								// ゲーム開始：進行状況を記録
								setUserGame(interaction.user.id, 'janken', progress_id);
								setUserGame(opponent.id, 'janken', progress_id);

								// 60秒たっても選択されなかったら勝負破棄
								const timeout_id = setTimeout(async () => {
									const timeoutEmbed = new EmbedBuilder()
										.setTitle('⏰ 時間切れ')
										.setDescription('時間切れとなったため、勝負は破棄されました')
										.setColor(0x99aab5);
									select_message.edit({ content: null, embeds: [timeoutEmbed], components: [] });
									await interaction.followUp({
										content: '時間切れとなったため、勝負は破棄されました',
										flags: [MessageFlags.Ephemeral],
									});
									delete janken_progress_data[progress_id];
									// タイムアウト時も進行状況をクリア
									clearUserGame(interaction.user.id);
									clearUserGame(opponent.id);
								}, 60000);
								janken_progress_data[progress_id] = {
									user: interaction.user,
									opponent: opponent,
									bet: bet,
									timeout_id: timeout_id,
									user_hand: null,
									opponent_hand: null,
									status: 'selecting_hands',
									message: select_message,
								};
							} else {
								clearUserGame(interaction.user.id);
								if (!interaction.replied && !interaction.deferred) {
									const errorEmbed = new EmbedBuilder()
										.setTitle('❌ エラー')
										.setDescription(`対戦相手のロメコインが不足しています`)
										.addFields(
											{
												name: `${opponent}の現在の所持ロメコイン`,
												value: `${ROMECOIN_EMOJI}${await getData(opponent.id, romecoin_data, 0)}`,
												inline: true,
											},
											{ name: '必要なロメコイン', value: `${ROMECOIN_EMOJI}${bet}`, inline: true }
										)
										.setColor(0xff0000);
									await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
								}
							}
						} else {
							clearUserGame(interaction.user.id);
							if (!interaction.replied && !interaction.deferred) {
								const errorEmbed = new EmbedBuilder()
									.setTitle('❌ エラー')
									.setDescription('自分自身やクロスロイド以外のBotと対戦することはできません')
									.setColor(0xff0000);
								await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
							}
						}
					}
					// 対戦相手が指定されていない場合は対戦募集ボードを表示
					else {
						const acceptButton = new ButtonBuilder()
							.setCustomId(`janken_accept_${progress_id}`)
							.setLabel('受ける')
							.setStyle(ButtonStyle.Success);
						const row = new ActionRowBuilder().addComponents(acceptButton);

						const embed = new EmbedBuilder()
							.setTitle('✂️ じゃんけん勝負募集')
							.setDescription(
								`${interaction.user} が誰でも挑戦可能なじゃんけん勝負を開始しました。\n\n**誰でも「受ける」ボタンを押して挑戦できます！**`
							)
							.addFields(
								{ name: 'ルール', value: 'グー・チョキ・パーで勝負', inline: true },
								{ name: 'ベット', value: `${ROMECOIN_EMOJI}${bet}`, inline: true },
								{ name: '注意', value: '受諾後、キャンセル不可', inline: false }
							)
							.setColor(0xffa500)
							.setThumbnail(interaction.user.displayAvatarURL());

						if (interaction.replied || interaction.deferred) {
							clearUserGame(interaction.user.id);
							return;
						}

						const replyMessage = await interaction.reply({
							content: null,
							embeds: [embed],
							components: [row],
							fetchReply: true,
						}).catch((error) => {
							clearUserGame(interaction.user.id);
							if (error.code !== 10062 && error.code !== 40060) {
								console.error('[Janken] 応答エラー:', error);
							}
							return null;
						});

						if (!replyMessage) {
							return;
						}
						// ゲーム開始：進行状況を記録（募集段階）
						setUserGame(interaction.user.id, 'janken', progress_id);
						const timeout_id = setTimeout(async () => {
							const timeoutEmbed = new EmbedBuilder()
								.setTitle('⏰ 時間切れ')
								.setDescription('時間切れとなったため、対戦募集は終了しました')
								.setColor(0x99aab5);
							await replyMessage.edit({ content: null, embeds: [timeoutEmbed], components: [] });
							delete janken_progress_data[progress_id];
							// タイムアウト時も進行状況をクリア
							clearUserGame(interaction.user.id);
						}, 60000);
						janken_progress_data[progress_id] = {
							user: interaction.user,
							opponent: null,
							bet: bet,
							timeout_id: timeout_id,
							user_hand: null,
							opponent_hand: null,
							status: 'waiting_for_opponent',
							message: replyMessage,
						};
					}
				} else {
					clearUserGame(interaction.user.id);
					if (!interaction.replied && !interaction.deferred) {
						try {
							await interaction.reply({
								content: `ロメコインが不足しています\n現在の所持ロメコイン: ${ROMECOIN_EMOJI}${await getData(
									interaction.user.id,
									romecoin_data,
									0
								)}\n必要なロメコイン: ${ROMECOIN_EMOJI}${bet}`,
								flags: [MessageFlags.Ephemeral],
							});
						} catch (replyError) {
							// Unknown interactionエラー（コード10062, 40060）は無視
							if (replyError.code !== 10062 && replyError.code !== 40060) {
								console.error('jankenコマンド応答エラー:', replyError);
							}
						}
					}
				}
			} else {
				clearUserGame(interaction.user.id);
				if (!interaction.replied && !interaction.deferred) {
					try {
						await interaction.reply({
							content: 'あなたは現在対戦中のため新規の対戦を開始できません',
							flags: [MessageFlags.Ephemeral],
						});
					} catch (replyError) {
						// Unknown interactionエラー（コード10062, 40060）は無視
						if (replyError.code !== 10062 && replyError.code !== 40060) {
							console.error('jankenコマンド応答エラー:', replyError);
						}
					}
				}
			}
			} catch (error) {
				clearUserGame(interaction.user.id);
				// Unknown interactionエラー（コード10062, 40060）は無視
				if (error.code === 10062 || error.code === 40060) {
					return;
				}
				console.error('jankenコマンドエラー:', error);
				// エラーが発生した場合、まだ応答していなければエラーメッセージを送信
				if (!interaction.replied && !interaction.deferred) {
					try {
						await interaction.reply({
							content: 'エラーが発生しました。',
							flags: [MessageFlags.Ephemeral],
						}).catch(() => {});
					} catch (replyError) {
						// 応答エラーも無視（インタラクションが既に期限切れの可能性）
						if (replyError.code !== 10062 && replyError.code !== 40060) {
							console.error('[Janken] 応答エラー:', replyError);
						}
					}
				}
				// Unknown interactionエラー（コード10062）は無視（インタラクションが既に期限切れ）
				if (error.code === 10062 || error.code === 40060) {
					return;
				}
				if (!interaction.replied && !interaction.deferred) {
					try {
						await interaction.reply({ content: 'エラーが発生しました。', flags: [MessageFlags.Ephemeral] });
					} catch (replyError) {
						// 応答エラーも無視（インタラクションが既に期限切れの可能性）
						if (replyError.code !== 10062 && replyError.code !== 40060) {
							console.error('jankenコマンド応答エラー:', replyError);
						}
					}
				}
			}
		} else if (interaction.commandName === 'database_export') {
			if (await checkAdmin(interaction.member)) {
				fs.writeFile('./.tmp/romecoin_data.json', JSON.stringify(romecoin_data), (err) => {
					if (err) {
						throw err;
					}
				});

				await interaction.reply({ files: ['./.tmp/romecoin_data.json'], ephemeral: true });
			}
		} else if (interaction.commandName === 'data_migrate') {
			if (!(await checkAdmin(interaction.member))) {
				return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
			}

			const targetUser = interaction.options.getUser('user');
			if (!targetUser) {
				return interaction.reply({ content: '❌ ユーザーを指定してください。', ephemeral: true });
			}

			const fs = require('fs');
			const path = require('path');
			const { migrateData } = require('./dataAccess');
			const persistence = require('./persistence');

			let migratedCount = 0;
			const results = [];

			// 各データファイルを引き継ぎ
			const files = [
				{ file: 'duel_data.json', name: '決闘データ' },
				{ file: 'janken_data.json', name: 'じゃんけんデータ' },
				{ file: 'romecoin_data.json', name: 'ロメコインデータ' },
				{ file: 'activity_data.json', name: 'アクティビティデータ' },
				{ file: 'custom_cooldowns.json', name: 'クールダウンデータ', prefix: 'battle_' },
			];

			for (const { file, name, prefix = '' } of files) {
				const filePath = path.join(__dirname, '..', file);
				if (fs.existsSync(filePath)) {
					try {
						const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
						const migrated = await migrateData(targetUser.id, data, prefix);
						if (migrated) {
							fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
							migratedCount++;
							results.push(`✅ ${name}`);
						} else {
							results.push(`⏭️ ${name} (引き継ぎ不要)`);
						}
					} catch (e) {
						results.push(`❌ ${name} (エラー: ${e.message})`);
					}
				}
			}

			// Memory storeに保存
			await persistence.save(interaction.client).catch(() => {});

			const resultText = results.join('\n');
			await interaction.reply({
				content: `📊 **データ引き継ぎ結果**\n対象: <@${targetUser.id}>\n\n${resultText}\n\n引き継ぎ完了: ${migratedCount}件`,
				ephemeral: true,
			});
		}
	} else if (interaction.isButton()) {
		// romecoin_ranking ページネーションボタン処理
		if (interaction.customId.startsWith('romecoin_ranking_')) {
			const parts = interaction.customId.split('_');
			const action = parts[2]; // 'prev' or 'next'
			const currentPage = parseInt(parts[3]);
			const commandUserId = parts[4]; // コマンド実行者のID

			// コマンド実行者のみが操作できるようにチェック
			if (interaction.user.id !== commandUserId) {
				return interaction.reply({
					content: 'このランキングを表示したユーザーのみが操作できます。',
					ephemeral: true,
				});
			}

			// データを配列に変換
			// 黒須銀行（クロスロイド）を除外
			const botUserId = interaction.client.user.id;
			const sortedData = await Promise.all(
				Object.entries(romecoin_data)
					.filter(([key, value]) => {
						if (key === botUserId) return false;
						if (!/^\d+$/.test(key)) {
							return true;
						}
						return key !== botUserId;
					})
					.map(async ([key, value]) => {
						const isNotionName = !/^\d+$/.test(key);
						let discordId = key;

						if (isNotionName) {
							discordId = (await notionManager.getDiscordId(key)) || key;
							if (discordId === botUserId) return null;
						}

						return { key, discordId, displayName: isNotionName ? key : null, value };
					})
			);
			
			const filteredData = sortedData.filter(item => item !== null);
			filteredData.sort((a, b) => b.value - a.value);

			const ITEMS_PER_PAGE = 10;
			const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);

			let newPage = currentPage;
			if (action === 'prev' && currentPage > 0) {
				newPage = currentPage - 1;
			} else if (action === 'next' && currentPage < totalPages - 1) {
				newPage = currentPage + 1;
			}

			// ランキング表示用の関数
			const buildRankingEmbed = (page) => {
				const startIndex = page * ITEMS_PER_PAGE;
				const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredData.length);
				const pageData = filteredData.slice(startIndex, endIndex);

				let rankingText = '';
				for (let i = 0; i < pageData.length; i++) {
					const rank = startIndex + i + 1;
					const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
					const display = pageData[i].displayName
						? `${pageData[i].displayName} (<@${pageData[i].discordId}>)`
						: `<@${pageData[i].discordId}>`;
					rankingText += `${medal} ${display} - ${ROMECOIN_EMOJI}${pageData[i].value}\n`;
				}

				if (rankingText === '') {
					rankingText = 'データがありません';
				}

				const embed = new EmbedBuilder()
					.setTitle('🏆 ROMECOINランキング')
					.setDescription(rankingText)
					.setColor(0xffd700)
					.setFooter({ text: `ページ ${page + 1}/${totalPages} | 総登録者数: ${filteredData.length}人` })
					.setTimestamp();

				return embed;
			};

			// ボタン作成
			const buildButtons = (page, userId) => {
				const row = new ActionRowBuilder();

				const prevButton = new ButtonBuilder()
					.setCustomId(`romecoin_ranking_prev_${page}_${userId}`)
					.setLabel('前へ')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === 0);

				const nextButton = new ButtonBuilder()
					.setCustomId(`romecoin_ranking_next_${page}_${userId}`)
					.setLabel('次へ')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page >= totalPages - 1);

				row.addComponents(prevButton, nextButton);
				return row;
			};

			await interaction.update({
				embeds: [buildRankingEmbed(newPage)],
				components: totalPages > 1 ? [buildButtons(newPage, commandUserId)] : [],
			});

			return;
		}

		// jankenボタンインタラクション処理(対戦承諾)
		if (interaction.customId.startsWith('janken_accept_')) {
			const progress_id = interaction.customId.split('_')[2];

			// 被爆ロールチェック：被爆ロールがついている人は受諾できない
			if (interaction.member.roles.cache.has(RADIATION_ROLE_ID)) {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('被爆ロールがついているため、対戦を受諾できません。')
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
			}

			if (
				interaction.user.id !== janken_progress_data[progress_id].user.id &&
				(await getData(interaction.user.id, romecoin_data, 0)) >= janken_progress_data[progress_id].bet
			) {
				if (
					!Object.values(janken_progress_data).some(
						(data) =>
							(data.user && data.user.id === interaction.user.id) ||
							(data.opponent && data.opponent.id === interaction.user.id)
					)
				) {
					clearTimeout(janken_progress_data[progress_id].timeout_id);
					const rockButton = new ButtonBuilder()
						.setCustomId(`janken_rock_${progress_id}`)
						.setLabel('グー')
						.setEmoji('✊')
						.setStyle(ButtonStyle.Primary);
					const scissorsButton = new ButtonBuilder()
						.setCustomId(`janken_scissors_${progress_id}`)
						.setLabel('チョキ')
						.setEmoji('✌️')
						.setStyle(ButtonStyle.Success);
					const paperButton = new ButtonBuilder()
						.setCustomId(`janken_paper_${progress_id}`)
						.setLabel('パー')
						.setEmoji('✋')
						.setStyle(ButtonStyle.Danger);
					const row = new ActionRowBuilder().addComponents(rockButton, scissorsButton, paperButton);
					// 最初のメッセージを編集
					const startEmbed = new EmbedBuilder()
						.setTitle('✂️ じゃんけん勝負開始')
						.setDescription(
							`${janken_progress_data[progress_id].user} 対戦相手が見つかりました！\n対戦相手は${interaction.user}です`
						)
						.addFields(
							{
								name: 'ベット',
								value: `${ROMECOIN_EMOJI}${janken_progress_data[progress_id].bet}`,
								inline: true,
							},
							{ name: 'ルール', value: 'グー・チョキ・パーで勝負', inline: true }
						)
						.setColor(0xffa500);

					try {
						// 最初のメッセージを編集（オープンチャレンジの場合）
						if (janken_progress_data[progress_id].message) {
							await janken_progress_data[progress_id].message.edit({
								content: null,
								embeds: [startEmbed],
								components: [row],
							});
						} else {
							// メッセージが保存されていない場合は新しいメッセージとして送信
							await interaction.channel.send({
								content: null,
								embeds: [startEmbed],
								components: [row],
							});
						}

						// インタラクションに応答（既に応答済みの場合は無視）
						if (!interaction.replied && !interaction.deferred) {
							await interaction.deferUpdate().catch(() => {});
						}
					} catch (error) {
						console.error('じゃんけん受諾処理エラー:', error);
						// エラーが発生しても処理を続行
					}

					janken_progress_data[progress_id].opponent = interaction.user;
					janken_progress_data[progress_id].status = 'selecting_hands';
					const timeout_id = setTimeout(async () => {
						const timeoutEmbed = new EmbedBuilder()
							.setTitle('⏰ 時間切れ')
							.setDescription('時間切れとなったため、勝負は破棄されました')
							.setColor(0x99aab5);
						if (janken_progress_data[progress_id] && janken_progress_data[progress_id].message) {
							await janken_progress_data[progress_id].message
								.edit({ content: null, embeds: [timeoutEmbed], components: [] })
								.catch(() => {});
						}
						delete janken_progress_data[progress_id];
					}, 60000);
					janken_progress_data[progress_id].timeout_id = timeout_id;
				} else {
					const errorEmbed = new EmbedBuilder()
						.setTitle('❌ エラー')
						.setDescription('あなたは現在対戦中のため対戦ボードを承諾できません')
						.setColor(0xff0000);
					await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
				}
			} else {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('自分自身やロメコインが不足しているユーザーは対戦できません')
					.setColor(0xff0000);
				await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
			}
		}
		// jankenボタンインタラクション処理(手選択)
		else if (interaction.customId.startsWith('janken_')) {
			const progress_id = interaction.customId.split('_')[2];
			const progress = janken_progress_data[progress_id];

			// progressが存在しない、または必要なデータが不足している場合はエラー
			if (!progress || !progress.user) {
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('この勝負は既に終了しているか、無効です。')
					.setColor(0xff0000);
				return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
			}

			// 既に両方の手が選択されている場合は処理しない
			if (progress.user_hand && progress.opponent_hand) {
				return;
			}

			// ユーザーの手選択処理
			if (interaction.user.id === progress.user.id) {
				// 既に手を選択している場合は処理しない
				if (progress.user_hand) {
					return;
				}
				progress.user_hand = interaction.customId.split('_')[1];
				
				// クロスロイドと対戦する場合、ユーザーが手を選んだタイミングでクロスロイドの手をランダムに決定
				if (progress.opponent && progress.opponent.id === interaction.client.user.id && !progress.opponent_hand) {
					const hands = ['rock', 'scissors', 'paper'];
					progress.opponent_hand = hands[Math.floor(Math.random() * hands.length)];
				}
				
				const handEmbed = new EmbedBuilder()
					.setTitle('✂️ 手を選択しました')
					.setDescription(
						`あなたの手は${RSPEnum[progress.user_hand]}に決定しました。\n対戦相手の手を待っています...`
					)
					.setColor(0x00ff00);
				try {
					if (!interaction.replied && !interaction.deferred) {
						await interaction.reply({ embeds: [handEmbed], flags: [MessageFlags.Ephemeral] });
					}
				} catch (error) {
					console.error('手選択応答エラー:', error);
				}
			}
			// 対戦相手の手選択処理
			else if (progress.opponent && interaction.user.id === progress.opponent.id) {
				// 既に手を選択している場合は処理しない
				if (progress.opponent_hand) {
					return;
				}
				progress.opponent_hand = interaction.customId.split('_')[1];
				const handEmbed = new EmbedBuilder()
					.setTitle('✂️ 手を選択しました')
					.setDescription(
						`あなたの手は${RSPEnum[progress.opponent_hand]}に決定しました。\n対戦相手の手を待っています...`
					)
					.setColor(0x00ff00);
				try {
					if (!interaction.replied && !interaction.deferred) {
						await interaction.reply({ embeds: [handEmbed], flags: [MessageFlags.Ephemeral] });
					}
				} catch (error) {
					console.error('手選択応答エラー:', error);
				}
			} else {
				// 該当するユーザーではない場合
				const errorEmbed = new EmbedBuilder()
					.setTitle('❌ エラー')
					.setDescription('あなたはこの勝負に参加していません。')
					.setColor(0xff0000);
				try {
					if (!interaction.replied && !interaction.deferred) {
						return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
					}
				} catch (error) {
					console.error('エラー応答エラー:', error);
				}
				return;
			}

			// 勝敗判定
			if (progress.user_hand && progress.opponent_hand) {
				clearTimeout(progress.timeout_id);
				let winner = null;
				let loser = null;
				let isDraw = false;

				if (progress.user_hand === progress.opponent_hand) {
					isDraw = true;
				} else if (
					(progress.user_hand === 'rock' && progress.opponent_hand === 'scissors') ||
					(progress.user_hand === 'scissors' && progress.opponent_hand === 'paper') ||
					(progress.user_hand === 'paper' && progress.opponent_hand === 'rock')
				) {
					winner = progress.user;
					loser = progress.opponent;
					await updateRomecoin(
						progress.user.id,
						(current) => Math.round((current || 0) + progress.bet),
						{
							log: true,
							client: interaction.client,
							reason: `じゃんけん勝利: ${progress.opponent.tag} との対戦`,
							metadata: {
								targetUserId: progress.opponent.id,
								commandName: 'janken',
							},
						}
					);
					await updateRomecoin(
						progress.opponent.id,
						(current) => Math.round((current || 0) - progress.bet),
						{
							log: true,
							client: interaction.client,
							reason: `じゃんけん敗北: ${progress.user.tag} との対戦`,
							metadata: {
								targetUserId: progress.user.id,
								commandName: 'janken',
							},
						}
					);
				} else {
					winner = progress.opponent;
					loser = progress.user;
					await updateRomecoin(
						progress.user.id,
						(current) => Math.round((current || 0) - progress.bet),
						{
							log: true,
							client: interaction.client,
							reason: `じゃんけん敗北: ${progress.opponent.tag} との対戦`,
							metadata: {
								targetUserId: progress.opponent.id,
								commandName: 'janken',
							},
						}
					);
					await updateRomecoin(
						progress.opponent.id,
						(current) => Math.round((current || 0) + progress.bet),
						{
							log: true,
							client: interaction.client,
							reason: `じゃんけん勝利: ${progress.user.tag} との対戦`,
							metadata: {
								targetUserId: progress.user.id,
								commandName: 'janken',
							},
						}
					);
				}

				// じゃんけんの勝敗記録（引き分け以外の場合のみ）
				if (!isDraw && winner && loser && !winner.bot && !loser.bot) {
					const fs = require('fs');
					const path = require('path');
					const persistence = require('./persistence');
					const DATA_FILE = path.join(__dirname, '..', 'janken_data.json');
					let jankenData = {};
					if (fs.existsSync(DATA_FILE)) {
						try {
							jankenData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
						} catch (e) {
							console.error('じゃんけんデータ読み込みエラー:', e);
						}
					}

					// データ引き継ぎ（ID → Notion名）
					await migrateData(winner.id, jankenData);
					await migrateData(loser.id, jankenData);

					// 勝者のデータを更新
					await updateData(winner.id, jankenData, (current) => {
						const data = current || { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
						data.wins++;
						data.streak++;
						if (data.streak > data.maxStreak) {
							data.maxStreak = data.streak;
						}
						return data;
					});

					// 敗者のデータを更新
					await updateData(loser.id, jankenData, (current) => {
						const data = current || { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
						data.losses++;
						data.streak = 0;
						return data;
					});

					try {
						fs.writeFileSync(DATA_FILE, JSON.stringify(jankenData, null, 2));
						// Memory storeに保存（clientはinteractionから取得）
						const client = interaction.client;
						if (client) {
							persistence.save(client).catch((err) => console.error('Memory store保存エラー:', err));
						}
					} catch (e) {
						console.error('じゃんけんデータ書き込みエラー:', e);
					}
				}

				const resultEmbed = new EmbedBuilder()
					.setTitle(isDraw ? '⚖️ じゃんけん引き分け' : '✂️ じゃんけん決着')
					.setColor(isDraw ? 0x99aab5 : 0xffd700)
					.setDescription(`${progress.user} vs ${progress.opponent}`)
					.addFields(
						{ name: `${progress.user.username}`, value: `${RSPEnum[progress.user_hand]}`, inline: true },
						{
							name: `${progress.opponent.username}`,
							value: `${RSPEnum[progress.opponent_hand]}`,
							inline: true,
						},
						{ name: 'ベット', value: `${ROMECOIN_EMOJI}${progress.bet}`, inline: true }
					);

				if (isDraw) {
					resultEmbed.addFields({ name: '結果', value: '引き分け', inline: false });
				} else {
					resultEmbed.addFields(
						{ name: '🏆 勝利者', value: `${winner}`, inline: false },
						{
							name: '獲得/損失',
							value: `${winner} は ${ROMECOIN_EMOJI}${progress.bet} を獲得\n${loser} は ${ROMECOIN_EMOJI}${progress.bet} を失いました`,
							inline: false,
						}
					);
				}

				// ゲーム終了：進行状況をクリア
				clearUserGame(progress.user.id);
				if (progress.opponent) {
					clearUserGame(progress.opponent.id);
				}

				// 最初のメッセージを編集
				try {
					if (progress.message) {
						await progress.message.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
					} else {
						// メッセージが保存されていない場合は新しいメッセージとして送信
						await interaction.channel.send({ embeds: [resultEmbed], components: [] }).catch(() => {});
					}
				} catch (error) {
					console.error('結果表示エラー:', error);
				}
				delete janken_progress_data[progress_id];
			}
		}
	}
}

async function messageCreate(message) {
	if (message.author.bot) return;
	if (message_cooldown_users.includes(message.author.id)) return;

	// 被爆ロールチェック：被爆ロールがついている人はロメコインが溜まらない
	if (message.member && message.member.roles.cache.has(RADIATION_ROLE_ID)) {
		message_cooldown_users.push(message.author.id);
		return;
	}

	let score = 10;

	const generationRoles = [
		'1431905155938258988', // 第1世代
		'1431905155938258989', // 第2世代
		'1431905155938258990', // 第3世代
		'1431905155938258991', // 第4世代
		'1431905155938258992', // 第5世代
		'1431905155938258993', // 第6世代
		'1431905155938258994', // 第7世代
		'1431905155955294290', // 第8世代
		'1431905155955294291', // 第9世代
		'1431905155955294292', // 第10世代
		'1431905155955294293', // 第11世代
		'1431905155955294294', // 第12世代
		'1431905155955294295', // 第13世代
		'1431905155955294296', // 第14世代
		'1431905155955294297', // 第15世代
		'1431905155955294298', // 第16世代
		'1431905155955294299', // 第17世代
		'1431905155984392303', // 第18世代
		//'1433777496767074386' // 第19世代
	];

	// 新規
	if (!message.member.roles.cache.some((role) => generationRoles.includes(role.id))) {
		score *= 1.1;
	}

	// 直近10件のメッセージ中で会話している人の数
	let talkingMembers = [];
	(await message.channel.messages.fetch({ limit: 10 })).forEach((_message) => {
		if (
			!_message.author.bot &&
			_message.author.id !== message.author.id &&
			!talkingMembers.includes(_message.author.id)
		) {
			talkingMembers.push(_message.author.id);
		}
	});
	score *= 1 + talkingMembers.length / 10;

	// 深夜
	if (message.createdAt.getHours() < 6) {
		score *= 1.5;
	}

	// データ引き継ぎ（ID → Notion名）
	await migrateData(message.author.id, romecoin_data);

	// ロメコインを更新（ログ付き）
	const previousBalance = await getData(message.author.id, romecoin_data, 0);
	await updateData(message.author.id, romecoin_data, (current) => {
		return Math.round((current || 0) + score);
	});
	const newBalance = await getData(message.author.id, romecoin_data, 0);
	
	// ログ送信（変動があった場合のみ）
	if (previousBalance !== newBalance && discordClient) {
		await logRomecoinChange(
			discordClient,
			message.author.id,
			previousBalance,
			newBalance,
			`メッセージ送信による獲得 (スコア: ${score.toFixed(1)})`,
			{
				commandName: 'message_create',
			}
		);
	}

	// 返信先のユーザーにも付与
	if (message.reference) {
		let reference;
		try {
			reference = await message.fetchReference();
		} catch (error) {
			// 参照先のメッセージが存在しない場合（削除されたメッセージへの返信など）はスキップ
			console.log('[ロメコイン] 返信先メッセージの取得に失敗しました（削除された可能性があります）:', error.message);
			return;
		}
		
		if (
			reference &&
			reference.guild &&
			reference.guild.id === message.guild.id &&
			!reference.author.bot &&
			reference.author.id !== message.author.id
		) {
			// 被爆ロールチェック：返信先が被爆ロールを持っている場合はロメコインを付与しない
			const referenceMember = await message.guild.members.fetch(reference.author.id).catch(() => null);
			if (referenceMember && !referenceMember.roles.cache.has(RADIATION_ROLE_ID)) {
				// データ引き継ぎ（ID → Notion名）
				await migrateData(reference.author.id, romecoin_data);

				// ロメコインを更新（ログ付き）
				const refPreviousBalance = await getData(reference.author.id, romecoin_data, 0);
				await updateData(reference.author.id, romecoin_data, (current) => {
					return Math.round((current || 0) + 5);
				});
				const refNewBalance = await getData(reference.author.id, romecoin_data, 0);
				
				// ログ送信（変動があった場合のみ）
				if (refPreviousBalance !== refNewBalance && discordClient) {
					await logRomecoinChange(
						discordClient,
						reference.author.id,
						refPreviousBalance,
						refNewBalance,
						`返信による獲得 (${message.author.tag} からの返信)`,
						{
							targetUserId: message.author.id,
							commandName: 'message_reply',
						}
					);
				}
			}
		}
	}

	message_cooldown_users.push(message.author.id);
}

async function messageReactionAdd(reaction, user) {
	if (user.bot || reaction.message.author.bot) return;
	if (reaction.message.author.id === user.id) return;
	if (reaction_cooldown_users.includes(user.id)) return;

	// 被爆ロールチェック：メッセージ送信者が被爆ロールを持っている場合はロメコインを付与しない
	const messageAuthorMember = await reaction.message.guild.members
		.fetch(reaction.message.author.id)
		.catch(() => null);
	if (messageAuthorMember && messageAuthorMember.roles.cache.has(RADIATION_ROLE_ID)) {
		reaction_cooldown_users.push(user.id);
		return;
	}

	// データ引き継ぎ（ID → Notion名）
	await migrateData(reaction.message.author.id, romecoin_data);

	// メッセージがリアクションされたときにも付与（ログ付き）
	const reactPreviousBalance = await getData(reaction.message.author.id, romecoin_data, 0);
	await updateData(reaction.message.author.id, romecoin_data, (current) => {
		return Math.round((current || 0) + 5);
	});
	const reactNewBalance = await getData(reaction.message.author.id, romecoin_data, 0);
	
	// ログ送信（変動があった場合のみ）
	if (reactPreviousBalance !== reactNewBalance && discordClient) {
		await logRomecoinChange(
			discordClient,
			reaction.message.author.id,
			reactPreviousBalance,
			reactNewBalance,
			`リアクションによる獲得 (${user.tag} からのリアクション)`,
			{
				targetUserId: user.id,
				commandName: 'message_reaction',
			}
		);
	}

	reaction_cooldown_users.push(user.id);
}

// romecoin_dataにアクセスする関数
function getRomecoinData() {
	return romecoin_data;
}

async function getRomecoin(userId) {
	try {
		// romecoin_dataが初期化されていない場合は空オブジェクトを使用
		const data = romecoin_data || {};
		const balance = await getData(userId, data, 0);
		return balance;
	} catch (error) {
		console.error('[getRomecoin] エラー:', error);
		console.error('[getRomecoin] userId:', userId);
		console.error('[getRomecoin] romecoin_data存在:', !!romecoin_data);
		// エラーが発生した場合は0を返す（デフォルト値）
		return 0;
	}
}

/**
 * ロメコインの変更ログを送信
 * @param {Object} client - Discordクライアント
 * @param {string} userId - ユーザーID
 * @param {number} previousBalance - 変更前の残高
 * @param {number} newBalance - 変更後の残高
 * @param {string} reason - 変更理由
 * @param {Object} metadata - 追加情報（オプション）
 */
async function logRomecoinChange(client, userId, previousBalance, newBalance, reason, metadata = {}) {
	if (!client) return;

	try {
		const logChannel = await client.channels.fetch(ROMECOIN_LOG_CHANNEL_ID).catch(() => null);
		if (!logChannel) return;

		// ユーザー情報を取得
		let userTag = userId;
		let executorTag = metadata.executorId || '';
		let targetUserTag = metadata.targetUserId || '';

		try {
			const user = await client.users.fetch(userId).catch(() => null);
			if (user) {
				userTag = `${user.tag} (<@${userId}>)`;
			} else {
				userTag = `<@${userId}>`;
			}
		} catch (e) {
			userTag = `<@${userId}>`;
		}

		if (metadata.executorId) {
			try {
				const executor = await client.users.fetch(metadata.executorId).catch(() => null);
				if (executor) {
					executorTag = `${executor.tag} (<@${metadata.executorId}>)`;
				} else {
					executorTag = `<@${metadata.executorId}>`;
				}
			} catch (e) {
				executorTag = `<@${metadata.executorId}>`;
			}
		}

		if (metadata.targetUserId && metadata.targetUserId !== userId) {
			try {
				const targetUser = await client.users.fetch(metadata.targetUserId).catch(() => null);
				if (targetUser) {
					targetUserTag = `${targetUser.tag} (<@${metadata.targetUserId}>)`;
				} else {
					targetUserTag = `<@${metadata.targetUserId}>`;
				}
			} catch (e) {
				targetUserTag = `<@${metadata.targetUserId}>`;
			}
		}

		const change = newBalance - previousBalance;
		const changeType = change > 0 ? '増額' : change < 0 ? '減額' : '変更なし';
		const changeEmoji = change > 0 ? '➕' : change < 0 ? '➖' : '➡️';

		const embed = new EmbedBuilder()
			.setTitle(`${changeEmoji} ロメコイン${changeType}`)
			.setColor(change > 0 ? 0x00ff00 : change < 0 ? 0xffa500 : 0x99aab5)
			.addFields(
				{ name: 'ユーザー', value: userTag, inline: true },
				{ name: '変更前', value: `${ROMECOIN_EMOJI}${previousBalance.toLocaleString()}`, inline: true },
				{ name: '変更後', value: `${ROMECOIN_EMOJI}${newBalance.toLocaleString()}`, inline: true },
				{ name: '変動額', value: `${change > 0 ? '+' : ''}${ROMECOIN_EMOJI}${change.toLocaleString()}`, inline: true },
				{ name: '理由', value: reason || '不明', inline: false }
			)
			.setTimestamp();

		// 追加情報がある場合は追加
		if (metadata.executorId) {
			embed.addFields({ name: '実行者', value: executorTag, inline: true });
		}
		if (metadata.targetUserId && metadata.targetUserId !== userId) {
			embed.addFields({ name: '対象ユーザー', value: targetUserTag, inline: true });
		}
		if (metadata.commandName) {
			embed.setFooter({ text: `コマンド: ${metadata.commandName}` });
		}

		await logChannel.send({ embeds: [embed] }).catch((err) => {
			console.error('[ロメコインログ] 送信エラー:', err);
		});
	} catch (error) {
		console.error('[ロメコインログ] エラー:', error);
	}
}

async function updateRomecoin(userId, updateFn, options = {}) {
	// romecoin_dataが初期化されていない場合は初期化
	if (!romecoin_data) {
		romecoin_data = {};
	}
	
	// 変更前の残高を取得
	const previousBalance = await getData(userId, romecoin_data, 0);
	
	await migrateData(userId, romecoin_data);
	await updateData(userId, romecoin_data, updateFn);
	
	// 変更後の残高を取得
	const newBalance = await getData(userId, romecoin_data, 0);
	
	// ログ送信（オプションで指定された場合）
	if (options.log && options.client && previousBalance !== newBalance) {
		await logRomecoinChange(
			options.client,
			userId,
			previousBalance,
			newBalance,
			options.reason || 'ロメコイン変更',
			options.metadata || {}
		);
	}
}

module.exports = {
	clientReady,
	interactionCreate,
	messageCreate,
	messageReactionAdd,
	getRomecoinData,
	getRomecoin,
	updateRomecoin,
	logRomecoinChange,
};
