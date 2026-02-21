const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require('discord.js');
const { IMAGE_DELETE_LOG_CHANNEL_ID } = require('../constants');
const { isImageOrVideo } = require('../utils');
const { deletedMessageInfo } = require('./proxy'); // Import from proxy module

// Webhookキャッシュ（チャンネルごとにwebhookオブジェクトを保存、トークンを含む）
// key: channelId, value: { webhook, timestamp }
const imageLogWebhookCache = new Map();
const IMAGE_LOG_WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

function setup(client) {
	// 画像削除ログ機能：画像メッセージが削除された際にログチャンネルに投稿
	client.on('messageDelete', async (message) => {
		try {
			if (message.author.bot) return;

			const hasMedia =
				message.attachments &&
				message.attachments.size > 0 &&
				Array.from(message.attachments.values()).some((attachment) => isImageOrVideo(attachment));

			if (hasMedia) {
				const deletedMessage = message;
				// 1分以内のメッセージのみ処理（管理者削除の可能性を除外するため）
				const messageAge = Date.now() - deletedMessage.createdTimestamp;
				if (messageAge < 60000) return;

				const logChannel = client.channels.cache.get(IMAGE_DELETE_LOG_CHANNEL_ID);
				if (logChannel) {
					let webhook;
					const channelId = logChannel.id;

					// キャッシュから取得を試みる
					const cached = imageLogWebhookCache.get(channelId);
					if (cached && Date.now() - cached.timestamp < IMAGE_LOG_WEBHOOK_CACHE_TTL) {
						try {
							// キャッシュされたwebhookがまだ有効か確認
							await cached.webhook.fetch();
							webhook = cached.webhook;
							console.log(`[ImageLog] キャッシュからwebhookを取得: ${webhook.id}`);
						} catch (fetchError) {
							// キャッシュが無効な場合は削除
							console.log(`[ImageLog] キャッシュされたwebhookが無効です。削除します。`);
							imageLogWebhookCache.delete(channelId);
						}
					}

					// キャッシュにない場合、既存のwebhookを探す
					if (!webhook) {
						try {
							const webhooks = await logChannel.fetchWebhooks();
							const matchingWebhooks = webhooks.filter((wh) => wh.name === 'CROSSROID Image Log');

							if (matchingWebhooks.length > 0) {
								// 余分なwebhookを削除（最初の1つ以外）
								if (matchingWebhooks.length > 1) {
									console.log(
										`[ImageLog] 余分なwebhookを検出（${matchingWebhooks.length}個）。削除します。`,
									);
									for (let i = 1; i < matchingWebhooks.length; i++) {
										try {
											await matchingWebhooks[i].delete();
											console.log(`[ImageLog] 余分なwebhookを削除: ${matchingWebhooks[i].id}`);
										} catch (deleteError) {
											console.error(
												`[ImageLog] webhook削除エラー: ${matchingWebhooks[i].id}`,
												deleteError,
											);
										}
									}
								}

								// 既存のwebhookを削除してから新しいものを作成（トークンが必要なため）
								try {
									await matchingWebhooks[0].delete();
									console.log(
										`[ImageLog] 既存のwebhookを削除（トークンがないため）: ${matchingWebhooks[0].id}`,
									);
								} catch (deleteError) {
									console.error(
										`[ImageLog] webhook削除エラー: ${matchingWebhooks[0].id}`,
										deleteError,
									);
								}
							}

							// 新しいwebhookを作成（トークンが含まれる）
							webhook = await logChannel.createWebhook({
								name: 'CROSSROID Image Log',
								avatar: client.user.displayAvatarURL(),
							});
							console.log(`[ImageLog] 新しいwebhookを作成: ${webhook.id}`);

							// キャッシュに保存（トークンを含む）
							imageLogWebhookCache.set(channelId, {
								webhook: webhook,
								timestamp: Date.now(),
							});
						} catch (webhookError) {
							console.error('[ImageLog] webhookの取得/作成に失敗:', webhookError);
						}
					}

					if (webhook) {
						const embed = new EmbedBuilder()
							.setTitle('🗑️ 画像削除ログ')
							.addFields(
								{ name: 'チャンネル', value: message.channel.toString(), inline: true },
								{ name: '投稿者', value: message.author.toString(), inline: true },
								{ name: '削除時刻', value: new Date().toLocaleString('ja-JP'), inline: true },
							)
							.setColor(0xff6b6b)
							.setTimestamp(new Date())
							.setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

						let content = message.content || '';
						if (content.length > 200) {
							content = content.slice(0, 197) + '...';
						}
						if (content) {
							embed.addFields({ name: '内容', value: content, inline: false });
						}

						const files = [];
						for (const attachment of message.attachments.values()) {
							if (isImageOrVideo(attachment)) {
								files.push({
									attachment: attachment.url,
									name: attachment.name,
								});
							}
						}

						await webhook.send({
							embeds: [embed],
							files: files,
							username: 'CROSSROID Image Log',
							avatarURL: client.user.displayAvatarURL(),
						});
					}
				}
			}
		} catch (error) {
			console.error('画像削除ログ機能でエラー:', error);
		}
	});

	// 削除ボタンのインタラクション処理
	client.on('interactionCreate', async (interaction) => {
		if (interaction.isButton()) {
			// 編集ボタン
			if (interaction.customId.startsWith('edit_')) {
				const customIdParts = interaction.customId.replace('edit_', '').split('_');
				const authorId = customIdParts[0];

				if (interaction.user.id === authorId) {
					const modal = new ModalBuilder().setCustomId('editmodal').setTitle('メッセージを編集');
					const input = new TextInputBuilder()
						.setCustomId('content')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setValue(interaction.message.content || '');
					const label = new LabelBuilder().setLabel('内容').setTextInputComponent(input);
					modal.addLabelComponents(label);
					await interaction.showModal(modal);
				} else {
					return interaction.reply({ content: 'このメッセージは投稿者本人のみが編集できます。', flags: 64 }); // 64 = MessageFlags.Ephemeral
				}
			} else if (interaction.customId.startsWith('delete_')) {
				// 削除ボタン
				const customIdParts = interaction.customId.replace('delete_', '').split('_');
				const authorId = customIdParts[0];

				if (interaction.user.id !== authorId) {
					return interaction.reply({ content: 'このメッセージは投稿者本人のみが削除できます。', flags: 64 }); // 64 = MessageFlags.Ephemeral
				}

				const messageInfo = deletedMessageInfo.get(interaction.message.id);

				// メッセージを削除（既に削除されている場合は無視）
				try {
					await interaction.message.delete();
				} catch (deleteError) {
					// Unknown Message (10008) は無視（既に削除済み）
					if (deleteError.code !== 10008) {
						throw deleteError; // その他のエラーは再スロー
					}
					// 10008の場合は既に削除済みなので処理を続行
				}

				deletedMessageInfo.delete(interaction.message.id);
				try {
					// ログ出力処理
					if (messageInfo && messageInfo.attachments && messageInfo.attachments.length > 0) {
						const hasMedia = messageInfo.attachments.some((attachment) => isImageOrVideo(attachment));

						if (hasMedia) {
							const logChannel = client.channels.cache.get(IMAGE_DELETE_LOG_CHANNEL_ID);
							if (logChannel) {
								let webhook;
								const channelId = logChannel.id;

								// キャッシュから取得を試みる
								const cached = imageLogWebhookCache.get(channelId);
								if (cached && Date.now() - cached.timestamp < IMAGE_LOG_WEBHOOK_CACHE_TTL) {
									try {
										// キャッシュされたwebhookがまだ有効か確認
										await cached.webhook.fetch();
										webhook = cached.webhook;
										console.log(`[ImageLog] キャッシュからwebhookを取得: ${webhook.id}`);
									} catch (fetchError) {
										// キャッシュが無効な場合は削除
										console.log(`[ImageLog] キャッシュされたwebhookが無効です。削除します。`);
										imageLogWebhookCache.delete(channelId);
									}
								}

								// キャッシュにない場合、既存のwebhookを探す
								if (!webhook) {
									try {
										const webhooks = await logChannel.fetchWebhooks();
										const matchingWebhooks = webhooks.filter(
											(wh) => wh.name === 'CROSSROID Image Log',
										);

										if (matchingWebhooks.length > 0) {
											// 余分なwebhookを削除（最初の1つ以外）
											if (matchingWebhooks.length > 1) {
												console.log(
													`[ImageLog] 余分なwebhookを検出（${matchingWebhooks.length}個）。削除します。`,
												);
												for (let i = 1; i < matchingWebhooks.length; i++) {
													try {
														await matchingWebhooks[i].delete();
														console.log(
															`[ImageLog] 余分なwebhookを削除: ${matchingWebhooks[i].id}`,
														);
													} catch (deleteError) {
														console.error(
															`[ImageLog] webhook削除エラー: ${matchingWebhooks[i].id}`,
															deleteError,
														);
													}
												}
											}

											// 既存のwebhookを削除してから新しいものを作成（トークンが必要なため）
											try {
												await matchingWebhooks[0].delete();
												console.log(
													`[ImageLog] 既存のwebhookを削除（トークンがないため）: ${matchingWebhooks[0].id}`,
												);
											} catch (deleteError) {
												console.error(
													`[ImageLog] webhook削除エラー: ${matchingWebhooks[0].id}`,
													deleteError,
												);
											}
										}

										// 新しいwebhookを作成（トークンが含まれる）
										webhook = await logChannel.createWebhook({
											name: 'CROSSROID Image Log',
											avatar: client.user.displayAvatarURL(),
										});
										console.log(`[ImageLog] 新しいwebhookを作成: ${webhook.id}`);

										// キャッシュに保存（トークンを含む）
										imageLogWebhookCache.set(channelId, {
											webhook: webhook,
											timestamp: Date.now(),
										});
									} catch (e) {
										console.error('[ImageLog] webhookの取得/作成に失敗:', e);
									}
								}

								if (webhook) {
									const embed = new EmbedBuilder()
										.setTitle('🗑️ 画像削除ログ（ユーザー削除）')
										.addFields(
											{ name: 'チャンネル', value: messageInfo.channel.toString(), inline: true },
											{ name: '投稿者', value: messageInfo.author.toString(), inline: true },
											{ name: '削除者', value: interaction.user.toString(), inline: true },
											{
												name: '削除時刻',
												value: new Date().toLocaleString('ja-JP'),
												inline: true,
											},
										)
										.setColor(0xff6b6b)
										.setTimestamp(new Date())
										.setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

									let content = messageInfo.content || '';
									if (content.length > 200) content = content.slice(0, 197) + '...';
									if (content) embed.addFields({ name: '内容', value: content, inline: false });

									const files = [];
									for (const attachment of messageInfo.attachments) {
										if (isImageOrVideo(attachment)) {
											files.push({ attachment: attachment.url, name: attachment.name });
										}
									}

									await webhook.send({
										embeds: [embed],
										files: files,
										username: 'CROSSROID Image Log',
										avatarURL: client.user.displayAvatarURL(),
									});
								}
							}
						}
					}

					await interaction.reply({ content: 'メッセージを削除しました。', flags: 64 }).catch(() => {}); // 64 = MessageFlags.Ephemeral
				} catch (error) {
					// Unknown Message (10008) は既に削除済みなので、エラーとして扱わない
					if (error.code === 10008) {
						await interaction
							.reply({ content: 'メッセージは既に削除されています。', flags: 64 })
							.catch(() => {}); // 64 = MessageFlags.Ephemeral
						return;
					}
					console.error('メッセージ削除でエラー:', error);
					await interaction.reply({ content: 'メッセージの削除に失敗しました。', flags: 64 }).catch(() => {}); // 64 = MessageFlags.Ephemeral
				}
			}
		} else if (interaction.isModalSubmit()) {
			// 編集モーダルの処理
			if (interaction.customId.startsWith('editmodal')) {
				const content = interaction.fields.getTextInputValue('content');
				const webhooks = await interaction.channel.fetchWebhooks();
				if (interaction.message.webhookId && !webhooks.has(interaction.message.webhookId)) {
					return interaction.reply({
						content: 'このメッセージが送信されたWebhookが削除されたため編集できません。',
						flags: 64,
					});
				} else {
					const webhook = webhooks.get(interaction.message.webhookId);
					await webhook.editMessage(interaction.message.id, {
						content: content,
					});
					await interaction.reply({ content: 'メッセージを編集しました', flags: 64 });
				}
			}
		}
	});
}

module.exports = { setup };
