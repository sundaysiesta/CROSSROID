const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { PROXY_COOLDOWN_MS } = require('../constants');
const { isImageOrVideo, containsFilteredWords } = require('../utils');

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

	// 画像・動画ファイルがあったorフィルタリングワードが含まれていたら画像代理投稿処理
	const hasMedia = Array.from(message.attachments?.values() ?? []).some((attachment) => isImageOrVideo(attachment));
	if (hasMedia || containsFilteredWords(message.content)) {
		// クールダウン中だったら代理投稿しない
		const lastProxiedAt = messageProxyCooldowns.get(message.author.id) || 0;
		if (Date.now() - lastProxiedAt < PROXY_COOLDOWN_MS) return;

		const messageId = message.id;

		// Webhookを取得または作成
		let webhook;
		const webhooks = await message.channel.fetchWebhooks();
		webhook = webhooks.find((wh) => wh.name === 'CROSSROID');

		if (!webhook) {
			webhook = await message.channel.createWebhook({
				name: 'CROSSROID',
				avatar: message.client.user.displayAvatarURL(),
			});
		}

		// 元のメッセージを削除（優先処理）
		const messageContent = message.content;
		const messageAuthor = message.author;
		const messageAttachments = Array.from(message.attachments.values());
		const messageChannel = message.channel;
		const displayName = message.member?.nickname || message.author.displayName;
		const avatarURL = message.author.displayAvatarURL();

		try {
			await message.delete();
			console.log(`[代理投稿] 元メッセージ削除成功: MessageID=${messageId}`);
		} catch (deleteError) {
			console.error(`[代理投稿] 元メッセージ削除エラー: MessageID=${messageId}`, deleteError);
			// 削除に失敗した場合は処理を中断
			return;
		}

		// 削除情報を保存（削除成功後に保存）
		const files = messageAttachments.map((attachment) => ({
			attachment: attachment.url,
			name: attachment.name,
		}));

		// 代理投稿を送信
		const deleteButton = new ButtonBuilder()
			.setCustomId(`delete_${messageAuthor.id}_${Date.now()}`)
			.setLabel('削除')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️');
		const row = new ActionRowBuilder().addComponents(deleteButton);

		try {
			const proxiedMessage = await webhook.send({
				content: messageContent,
				username: displayName,
				avatarURL: avatarURL,
				files: files,
				components: [row],
				allowedMentions: { parse: [] },
			});
			console.log(`[代理投稿] Webhook送信成功: MessageID=${messageId}, WebhookMessageID=${proxiedMessage.id}`);

			// 削除情報を保存
			deletedMessageInfo.set(proxiedMessage.id, {
				content: messageContent,
				author: messageAuthor,
				attachments: messageAttachments,
				channel: messageChannel,
				originalMessageId: messageId,
				timestamp: Date.now(),
			});
		} catch (webhookError) {
			console.error(`[代理投稿] Webhook送信エラー: MessageID=${messageId}`, webhookError);
			// Webhook送信に失敗しても、元のメッセージは既に削除されている
		}

		// クールダウンを更新
		messageProxyCooldowns.set(message.author.id, Date.now());
	}
}

module.exports = {
	clientReady,
	messageCreate,
	deletedMessageInfo,
};
