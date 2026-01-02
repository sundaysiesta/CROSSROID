const { PROXY_COOLDOWN_MS } = require('../constants');
const { containsFilteredWords } = require('../utils');

// 状態管理
let messageProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const deletedMessageInfo = new Map(); // key: messageId, value: { content, author, attachments, channel }

// 30分ごとにクールダウンをクリア
async function clientReady(client) {
	setInterval(() => {
		messageProxyCooldowns = new Map();
	}, 30 * 60 * 1000);
}

async function messageCreate(message) {
	if (message.author.bot || message.webhookId || message.system) return;

	// フィルタリングワードが含まれていたら代理投稿処理（画像代行機能は削除済み）
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

		// Webhookを取得または作成（削除前に準備）
		let webhook;
		try {
			const webhooks = await message.channel.fetchWebhooks();
			const matchingWebhooks = webhooks.filter((wh) => wh.name === 'CROSSROID');
			
			// 既存のwebhookがある場合は最初の1つを使用し、余分なものを削除
			if (matchingWebhooks.length > 0) {
				webhook = matchingWebhooks[0];
				// 余分なwebhookを削除（最初の1つ以外）
				if (matchingWebhooks.length > 1) {
					console.log(`[代理投稿] 余分なwebhookを検出（${matchingWebhooks.length}個）。削除します。`);
					for (let i = 1; i < matchingWebhooks.length; i++) {
						try {
							await matchingWebhooks[i].delete();
							console.log(`[代理投稿] 余分なwebhookを削除: ${matchingWebhooks[i].id}`);
						} catch (deleteError) {
							console.error(`[代理投稿] webhook削除エラー: ${matchingWebhooks[i].id}`, deleteError);
						}
					}
				}
			} else {
				// webhookが存在しない場合のみ新規作成
				webhook = await message.channel.createWebhook({
					name: 'CROSSROID',
					avatar: message.client.user.displayAvatarURL(),
				});
				console.log(`[代理投稿] 新しいwebhookを作成: ${webhook.id}`);
			}
		} catch (webhookError) {
			console.error(`[代理投稿] Webhook取得/作成エラー: MessageID=${messageId}`, webhookError);
			// Webhookの準備に失敗した場合は処理を中断（元メッセージは削除しない）
			return;
		}

		// ワードフィルターの場合、元のメッセージを即座に削除（BAN回避のため）
		try {
			await message.delete();
			console.log(`[代理投稿] 元メッセージ削除成功: MessageID=${messageId} (削除優先)`);
		} catch (deleteError) {
			console.error(`[代理投稿] 元メッセージ削除エラー: MessageID=${messageId}`, deleteError);
			// 削除に失敗した場合は処理を中断
			return;
		}

		// 代理投稿を送信（削除後に実行、画像は含めない）
		let proxiedMessage;
		try {
			// Discordのメッセージ長制限（2000文字）をチェック
			const MAX_CONTENT_LENGTH = 2000;
			let finalContent = messageContent || '';
			
			// 2000文字を超える場合は切り詰める
			if (finalContent.length > MAX_CONTENT_LENGTH) {
				const truncatedContent = finalContent.substring(0, MAX_CONTENT_LENGTH - 20); // 省略メッセージ用に20文字確保
				finalContent = truncatedContent + '\n\n...（文字数制限により省略）';
				console.log(`[代理投稿] メッセージを切り詰めました: ${messageContent.length}文字 → ${finalContent.length}文字`);
			}
			
			console.log(`[代理投稿] Webhook送信開始: MessageID=${messageId}, contentLength=${finalContent.length}文字`);
			proxiedMessage = await webhook.send({
				content: finalContent,
				username: displayName,
				avatarURL: avatarURL,
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

module.exports = {
	clientReady,
	messageCreate,
	deletedMessageInfo,
};
