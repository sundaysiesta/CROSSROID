const { EmbedBuilder } = require('discord.js');
const { IMAGE_DELETE_LOG_CHANNEL_ID } = require('../constants');
const { isImageOrVideo } = require('../utils');
const { deletedMessageInfo } = require('./proxy'); // Import from proxy module

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
					try {
						const webhooks = await logChannel.fetchWebhooks();
						const matchingWebhooks = webhooks.filter((wh) => wh.name === 'CROSSROID Image Log');
						
						if (matchingWebhooks.length > 0) {
							webhook = matchingWebhooks[0];
							// 余分なwebhookを削除（最初の1つ以外）
							if (matchingWebhooks.length > 1) {
								for (let i = 1; i < matchingWebhooks.length; i++) {
									try {
										await matchingWebhooks[i].delete();
									} catch (deleteError) {
										console.error(`[ImageLog] webhook削除エラー: ${matchingWebhooks[i].id}`, deleteError);
									}
								}
							}
						} else {
							webhook = await logChannel.createWebhook({
								name: 'CROSSROID Image Log',
								avatar: client.user.displayAvatarURL(),
							});
						}
					} catch (webhookError) {
						console.error('webhookの取得/作成に失敗:', webhookError);
					}

					if (webhook) {
						const embed = new EmbedBuilder()
							.setTitle('🗑️ 画像削除ログ')
							.addFields(
								{ name: 'チャンネル', value: message.channel.toString(), inline: true },
								{ name: '投稿者', value: message.author.toString(), inline: true },
								{ name: '削除時刻', value: new Date().toLocaleString('ja-JP'), inline: true }
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
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('delete_')) return;

		const customIdParts = interaction.customId.replace('delete_', '').split('_');
		const authorId = customIdParts[0];

		if (interaction.user.id !== authorId) {
			return interaction.reply({ content: 'このメッセージは投稿者本人のみが削除できます。', flags: 64 }); // 64 = MessageFlags.Ephemeral
		}

		try {
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

			// ログ出力処理
			if (messageInfo && messageInfo.attachments && messageInfo.attachments.length > 0) {
				const hasMedia = messageInfo.attachments.some((attachment) => isImageOrVideo(attachment));

				if (hasMedia) {
					const logChannel = client.channels.cache.get(IMAGE_DELETE_LOG_CHANNEL_ID);
					if (logChannel) {
						let webhook;
						try {
							const webhooks = await logChannel.fetchWebhooks();
							const matchingWebhooks = webhooks.filter((wh) => wh.name === 'CROSSROID Image Log');
							
							if (matchingWebhooks.length > 0) {
								webhook = matchingWebhooks[0];
								// 余分なwebhookを削除（最初の1つ以外）
								if (matchingWebhooks.length > 1) {
									for (let i = 1; i < matchingWebhooks.length; i++) {
										try {
											await matchingWebhooks[i].delete();
										} catch (deleteError) {
											console.error(`[ImageLog] webhook削除エラー: ${matchingWebhooks[i].id}`, deleteError);
										}
									}
								}
							} else {
								webhook = await logChannel.createWebhook({
									name: 'CROSSROID Image Log',
									avatar: client.user.displayAvatarURL(),
								});
							}
						} catch (e) {}

						if (webhook) {
							const embed = new EmbedBuilder()
								.setTitle('🗑️ 画像削除ログ（ユーザー削除）')
								.addFields(
									{ name: 'チャンネル', value: messageInfo.channel.toString(), inline: true },
									{ name: '投稿者', value: messageInfo.author.toString(), inline: true },
									{ name: '削除者', value: interaction.user.toString(), inline: true },
									{ name: '削除時刻', value: new Date().toLocaleString('ja-JP'), inline: true }
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
				await interaction.reply({ content: 'メッセージは既に削除されています。', flags: 64 }).catch(() => {}); // 64 = MessageFlags.Ephemeral
				return;
			}
			console.error('メッセージ削除でエラー:', error);
			await interaction.reply({ content: 'メッセージの削除に失敗しました。', flags: 64 }).catch(() => {}); // 64 = MessageFlags.Ephemeral
		}
	});
}

module.exports = { setup };
