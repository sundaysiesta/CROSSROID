const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { PROXY_COOLDOWN_MS } = require('../constants');
const { containsFilteredWords } = require('../utils');

// 状態管理
let messageProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const deletedMessageInfo = new Map(); // key: messageId, value: { content, author, attachments, channel }

// Webhookキャッシュ（チャンネルごとにwebhookオブジェクトを保存、トークンを含む）
// key: channelId, value: { webhook, timestamp }
const webhookCache = new Map();
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

// 30分ごとにクールダウンをクリア
async function clientReady(client) {
	setInterval(
		() => {
			messageProxyCooldowns = new Map();
		},
		30 * 60 * 1000,
	);
}

async function messageCreate(message) {
	if (message.author.bot || message.webhookId || message.system) return;

	// フィルタリングワードが含まれていたら代理投稿処理（画像代行機能は削除）
	const hasFilteredWords = containsFilteredWords(message.content);
	if (hasFilteredWords) {
		// クールダウン中だったら代理投稿しない
		const lastProxiedAt = messageProxyCooldowns.get(message.author.id) || 0;
		if (Date.now() - lastProxiedAt < PROXY_COOLDOWN_MS) return;

		const messageId = message.id;

		// 削除前にすべての必要な情報を保存
		const messageContent = message.content;
		const messageAuthor = message.author;
		const messageAuthorId = message.author.id;
		const messageAttachments = Array.from(message.attachments.values());
		const messageChannel = message.channel;
		const displayName = message.member?.nickname || message.author.displayName;
		const avatarURL = message.author.displayAvatarURL();

		// Webhookを取得または作成（共通関数を使用）
		let webhook;
		try {
			webhook = await getOrCreateWebhook(message.channel);
		} catch (webhookError) {
			console.error(`[代理投稿] Webhook取得/作成エラー: MessageID=${messageId}`, webhookError);
			console.error(`[代理投稿] エラー詳細:`, webhookError.stack || webhookError);
			// Webhookの準備に失敗した場合は処理を中断（元メッセージは削除しない）
			return;
		}

		// webhookが取得できていない場合は処理を中断
		if (!webhook) {
			console.error(`[代理投稿] Webhookが取得できませんでした: MessageID=${messageId}`);
			return;
		}

		// 編集ボタン
		const editButton = new ButtonBuilder()
			.setCustomId(`edit_${messageAuthorId}_${Date.now()}`)
			.setLabel('編集')
			.setStyle(ButtonStyle.Primary)
			.setEmoji('✏️');
		// 削除ボタンを事前に準備
		const deleteButton = new ButtonBuilder()
			.setCustomId(`delete_${messageAuthorId}_${Date.now()}`)
			.setLabel('削除')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️');
		const row = new ActionRowBuilder().addComponents(deleteButton, editButton);

		// ワードフィルターの場合、元のメッセージを即座に削除（BAN回避のため）
		try {
			await message.delete();
			console.log(`[代理投稿] 元メッセージ削除成功: MessageID=${messageId} (削除優先)`);
		} catch (deleteError) {
			console.error(`[代理投稿] 元メッセージ削除エラー: MessageID=${messageId}`, deleteError);
			// 削除に失敗した場合は処理を中断
			return;
		}

		// 代理投稿を送信（削除後に実行）
		let proxiedMessage;
		try {
			// Discordのメッセージ長制限（2000文字）をチェック
			const MAX_CONTENT_LENGTH = 2000;
			let finalContent = messageContent || '';

			// 2000文字を超える場合は切り詰める
			if (finalContent.length > MAX_CONTENT_LENGTH) {
				const truncatedContent = finalContent.substring(0, MAX_CONTENT_LENGTH - 20); // 省略メッセージ用に20文字確保
				finalContent = truncatedContent + '\n\n...（文字数制限により省略）';
				console.log(
					`[代理投稿] メッセージを切り詰めました: ${messageContent.length}文字 → ${finalContent.length}文字`,
				);
			}

			console.log(`[代理投稿] Webhook送信開始: MessageID=${messageId}, contentLength=${finalContent.length}文字`);
			proxiedMessage = await webhook.send({
				content: finalContent,
				username: displayName,
				avatarURL: avatarURL,
				components: [row],
				allowedMentions: { parse: [] },
			});
			console.log(`[代理投稿] Webhook送信成功: MessageID=${messageId}, WebhookMessageID=${proxiedMessage.id}`);
		} catch (webhookError) {
			console.error(`[代理投稿] Webhook送信エラー: MessageID=${messageId}`, webhookError);
			console.error(`[代理投稿] エラー詳細:`, webhookError.stack || webhookError);
			console.error(`[代理投稿] 送信データ:`, {
				contentLength: messageContent?.length || 0,
				displayName,
				hasAvatarURL: !!avatarURL,
			});
			// Webhook送信に失敗しても、元のメッセージは既に削除されている
		}

		// 削除情報を保存（Webhook送信が成功した場合のみ）
		if (proxiedMessage) {
			deletedMessageInfo.set(proxiedMessage.id, {
				content: messageContent,
				author: messageAuthor,
				attachments: messageAttachments,
				channel: messageChannel,
				originalMessageId: messageId,
				timestamp: Date.now(),
			});

			// クールダウンを更新（送信成功時のみ）
			messageProxyCooldowns.set(messageAuthorId, Date.now());
		}
	}
}

// Webhook取得関数をエクスポート（anonymous機能でも使用）
async function getOrCreateWebhook(channel) {
	const channelId = channel.id;
	let webhook;

	// キャッシュから取得を試みる
	const cached = webhookCache.get(channelId);
	if (cached && Date.now() - cached.timestamp < WEBHOOK_CACHE_TTL) {
		try {
			// キャッシュされたwebhookがまだ有効か確認
			await cached.webhook.fetch();
			webhook = cached.webhook;
			console.log(`[Webhook] キャッシュからwebhookを取得: ${webhook.id}`);
		} catch (fetchError) {
			// キャッシュが無効な場合は削除
			console.log(`[Webhook] キャッシュされたwebhookが無効です。キャッシュを削除します。`);
			webhookCache.delete(channelId);
			// 実際のwebhookが存在する場合は削除を試みる
			try {
				await cached.webhook.delete();
				console.log(`[Webhook] 無効なwebhookを削除: ${cached.webhook.id}`);
			} catch (deleteError) {
				// 削除に失敗しても続行（既に削除されている可能性がある）
				console.log(
					`[Webhook] webhook削除を試みましたが、既に存在しない可能性があります: ${cached.webhook.id}`,
				);
			}
		}
	}

	// キャッシュにない場合、既存のwebhookを探す
	if (!webhook) {
		try {
			// まず既存のwebhookをすべて取得
			const webhooks = await channel.fetchWebhooks();
			const matchingWebhooks = webhooks.filter((wh) => wh.name === 'CROSSROID');

			if (matchingWebhooks.length > 0) {
				console.log(`[Webhook] 既存の「CROSSROID」webhookを${matchingWebhooks.length}個発見しました。`);

				// トークンがあるwebhookをすべて取得
				const webhooksWithToken = matchingWebhooks.filter((wh) => wh.token);

				if (webhooksWithToken.length > 0) {
					// トークンがあるwebhookが複数ある場合、最新の1つ（IDが最大）を使用し、他は削除
					// IDが大きいほど新しいwebhook
					webhook = webhooksWithToken.reduce((latest, current) => {
						return BigInt(current.id) > BigInt(latest.id) ? current : latest;
					});

					console.log(
						`[Webhook] 既存のwebhook（自分が作成したもの）を使用: ${webhook.id} (${matchingWebhooks.length}個中から選択)`,
					);

					// キャッシュに保存
					webhookCache.set(channelId, {
						webhook: webhook,
						timestamp: Date.now(),
					});

					// 余分なwebhookをすべて削除（使用するもの以外）
					for (const wh of matchingWebhooks) {
						if (wh.id !== webhook.id) {
							try {
								await wh.delete();
								console.log(`[Webhook] 余分なwebhookを削除: ${wh.id}`);
							} catch (deleteError) {
								console.error(`[Webhook] webhook削除エラー: ${wh.id}`, deleteError);
							}
						}
					}
				} else {
					// トークンがない既存のwebhook（以前からすでにあるもの）をすべて削除
					console.log(
						`[Webhook] 既存のwebhookが見つかりましたが、トークンがないため削除します（${matchingWebhooks.length}個）。`,
					);
					for (const wh of matchingWebhooks) {
						try {
							await wh.delete();
							console.log(`[Webhook] 既存のwebhookを削除: ${wh.id}`);
						} catch (deleteError) {
							console.error(`[Webhook] webhook削除エラー: ${wh.id}`, deleteError);
						}
					}
				}
			}

			// webhookがまだ見つかっていない場合、新しいwebhookを作成（トークンが含まれる）
			if (!webhook) {
				// 作成前に再度確認（並行処理対策）
				const webhooksBeforeCreate = await channel.fetchWebhooks();
				const matchingBeforeCreate = webhooksBeforeCreate.filter((wh) => wh.name === 'CROSSROID');
				if (matchingBeforeCreate.length > 0) {
					console.log(`[Webhook] 作成前に既存のwebhookを再確認: ${matchingBeforeCreate.length}個発見`);
					const webhooksWithTokenBefore = matchingBeforeCreate.filter((wh) => wh.token);
					if (webhooksWithTokenBefore.length > 0) {
						webhook = webhooksWithTokenBefore.reduce((latest, current) => {
							return BigInt(current.id) > BigInt(latest.id) ? current : latest;
						});
						console.log(`[Webhook] 既存のwebhookを使用: ${webhook.id}`);
						webhookCache.set(channelId, {
							webhook: webhook,
							timestamp: Date.now(),
						});
						// 余分なものを削除
						for (const wh of matchingBeforeCreate) {
							if (wh.id !== webhook.id) {
								try {
									await wh.delete();
									console.log(`[Webhook] 余分なwebhookを削除: ${wh.id}`);
								} catch (deleteError) {
									console.error(`[Webhook] webhook削除エラー: ${wh.id}`, deleteError);
								}
							}
						}
					}
				}

				// それでもwebhookが見つからない場合のみ作成
				if (!webhook) {
					try {
						webhook = await channel.createWebhook({
							name: 'CROSSROID',
							avatar: channel.client.user.displayAvatarURL(),
						});
						console.log(`[Webhook] 新しいwebhookを作成: ${webhook.id}`);

						// キャッシュに保存（トークンを含む）
						webhookCache.set(channelId, {
							webhook: webhook,
							timestamp: Date.now(),
						});

						// 作成後に再度確認して、並行処理で複数作成された場合は余分なものを削除
						const webhooksAfterCreate = await channel.fetchWebhooks();
						const matchingAfterCreate = webhooksAfterCreate.filter((wh) => wh.name === 'CROSSROID');
						if (matchingAfterCreate.length > 1) {
							console.log(
								`[Webhook] 並行処理で複数のwebhookが作成されました（${matchingAfterCreate.length}個）。最新の1つだけを残します。`,
							);
							// 最新の1つ（IDが最大）を特定
							const latestWebhook = matchingAfterCreate.reduce((latest, current) => {
								return BigInt(current.id) > BigInt(latest.id) ? current : latest;
							});
							// 最新のものをwebhookとして使用
							webhook = latestWebhook;
							// キャッシュを更新
							webhookCache.set(channelId, {
								webhook: webhook,
								timestamp: Date.now(),
							});
							// 余分なものを削除
							for (const wh of matchingAfterCreate) {
								if (wh.id !== webhook.id) {
									try {
										await wh.delete();
										console.log(`[Webhook] 並行処理で作成された余分なwebhookを削除: ${wh.id}`);
									} catch (deleteError) {
										console.error(`[Webhook] webhook削除エラー: ${wh.id}`, deleteError);
									}
								}
							}
						}
					} catch (createError) {
						// webhook作成エラー（上限に達している可能性）
						if (createError.code === 30007) {
							console.error(`[Webhook] ⚠️ Webhookの上限に達しています。`);
							console.error(`[Webhook] ⚠️ 既存のwebhookを削除してから再試行します...`);

							// 「CROSSROID」という名前のwebhookをすべて削除
							const allWebhooks = await channel.fetchWebhooks();
							const crossroidWebhooks = Array.from(allWebhooks.values()).filter(
								(wh) => wh.name === 'CROSSROID',
							);
							if (crossroidWebhooks.length > 0) {
								console.log(
									`[Webhook] 「CROSSROID」webhook（${crossroidWebhooks.length}個）を削除します...`,
								);
								for (const wh of crossroidWebhooks) {
									try {
										await wh.delete();
										console.log(`[Webhook] webhookを削除: ${wh.id}`);
									} catch (deleteError) {
										console.error(`[Webhook] webhook削除エラー: ${wh.id}`, deleteError);
									}
								}
							}

							// キャッシュもクリア
							webhookCache.delete(channelId);

							// 少し待ってから再作成
							await new Promise((resolve) => setTimeout(resolve, 1000));

							try {
								webhook = await channel.createWebhook({
									name: 'CROSSROID',
									avatar: channel.client.user.displayAvatarURL(),
								});
								console.log(`[Webhook] 新しいwebhookを作成（再試行成功）: ${webhook.id}`);

								// キャッシュに保存
								webhookCache.set(channelId, {
									webhook: webhook,
									timestamp: Date.now(),
								});
							} catch (retryError) {
								console.error(`[Webhook] ⚠️ Webhookの再作成に失敗しました:`, retryError);
								throw retryError;
							}
						} else {
							console.error(`[Webhook] Webhook作成エラー:`, createError);
							throw createError;
						}
					}
				}
			}
		} catch (webhookError) {
			console.error(`[Webhook] Webhook取得/作成エラー:`, webhookError);
			throw webhookError;
		}
	}

	return webhook;
}

module.exports = {
	clientReady,
	messageCreate,
	deletedMessageInfo,
	getOrCreateWebhook,
};
