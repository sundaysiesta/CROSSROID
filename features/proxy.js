const { ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder } = require('discord.js');
const { PROXY_COOLDOWN_MS } = require('../constants');
const { isImageOrVideo, containsFilteredWords } = require('../utils');
const https = require('https');
const http = require('http');

// 状態管理
let messageProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const deletedMessageInfo = new Map(); // key: messageId, value: { content, author, attachments, channel }

// ファイルをダウンロードするヘルパー関数
function downloadFile(url) {
	return new Promise((resolve, reject) => {
		const protocol = url.startsWith('https') ? https : http;
		protocol
			.get(url, (response) => {
				if (response.statusCode !== 200) {
					reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
					return;
				}

				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('end', () => {
					resolve(Buffer.concat(chunks));
				});
				response.on('error', (error) => {
					reject(error);
				});
			})
			.on('error', (error) => {
				reject(error);
			})
			.setTimeout(10000, () => {
				reject(new Error('Download timeout'));
			});
	});
}

// 30分ごとにクールダウンをクリア
async function clientReady(client) {
	setInterval(() => {
		messageProxyCooldowns = new Map();
	}, 30 * 60 * 1000);
}

async function messageCreate(message) {
	if (message.author.bot || message.webhookId || message.system) return;

	// 画像・動画ファイルがあったorフィルタリングワードが含まれていたら画像代理投稿処理
	const hasMedia = Array.from(message.attachments?.values() ?? []).some((attachment) => isImageOrVideo(attachment));
	const hasFilteredWords = containsFilteredWords(message.content);
	if (hasMedia || hasFilteredWords) {
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

		// ファイルを削除前にダウンロードして保存（削除後URLが無効になる可能性があるため）
		const downloadedFiles = [];
		if (messageAttachments.length > 0) {
			try {
				for (const attachment of messageAttachments) {
					try {
						const buffer = await downloadFile(attachment.url);
						if (buffer) {
							downloadedFiles.push(
								new AttachmentBuilder(buffer, {
									name: attachment.name || 'file',
									description: attachment.description || undefined,
								})
							);
						}
					} catch (downloadError) {
						console.error(`[代理投稿] ファイルダウンロードエラー: ${attachment.name || 'unknown'}`, downloadError);
						// ダウンロードに失敗した場合は元のURLを使用（削除前なので有効な可能性がある）
						downloadedFiles.push({
							attachment: attachment.url,
							name: attachment.name,
						});
					}
				}
			} catch (error) {
				console.error(`[代理投稿] ファイル処理エラー: MessageID=${messageId}`, error);
				// ファイル処理に失敗した場合は元のURLを使用
				downloadedFiles.push(
					...messageAttachments.map((attachment) => ({
						attachment: attachment.url,
						name: attachment.name,
					}))
				);
			}
		}

		// Webhookを取得または作成（削除前に準備）
		let webhook;
		try {
			const webhooks = await message.channel.fetchWebhooks();
			webhook = webhooks.find((wh) => wh.name === 'CROSSROID');

			if (!webhook) {
				webhook = await message.channel.createWebhook({
					name: 'CROSSROID',
					avatar: message.client.user.displayAvatarURL(),
				});
			}
		} catch (webhookError) {
			console.error(`[代理投稿] Webhook取得/作成エラー: MessageID=${messageId}`, webhookError);
			// Webhookの準備に失敗した場合は処理を中断（元メッセージは削除しない）
			return;
		}

		// 削除ボタンを事前に準備
		const deleteButton = new ButtonBuilder()
			.setCustomId(`delete_${messageAuthorId}_${Date.now()}`)
			.setLabel('削除')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️');
		const row = new ActionRowBuilder().addComponents(deleteButton);

		// ワードフィルターまたは画像代行投稿の場合、元のメッセージを即座に削除（BAN回避のため）
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
			console.log(`[代理投稿] Webhook送信開始: MessageID=${messageId}, files=${downloadedFiles.length}件`);
			proxiedMessage = await webhook.send({
				content: messageContent,
				username: displayName,
				avatarURL: avatarURL,
				files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
				components: [row],
				allowedMentions: { parse: [] },
			});
			console.log(`[代理投稿] Webhook送信成功: MessageID=${messageId}, WebhookMessageID=${proxiedMessage.id}`);
		} catch (webhookError) {
			console.error(`[代理投稿] Webhook送信エラー: MessageID=${messageId}`, webhookError);
			console.error(`[代理投稿] エラー詳細:`, webhookError.stack || webhookError);
			console.error(`[代理投稿] 送信データ:`, {
				contentLength: messageContent?.length || 0,
				filesCount: downloadedFiles.length,
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
