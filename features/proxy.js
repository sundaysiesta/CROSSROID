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

		const files = message.attachments.map((attachment) => ({
			attachment: attachment.url,
			name: attachment.name,
		}));

		// 代理投稿を送信
		const deleteButton = new ButtonBuilder()
			.setCustomId(`delete_${message.author.id}_${Date.now()}`)
			.setLabel('削除')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️');
		const row = new ActionRowBuilder().addComponents(deleteButton);
		const displayName = message.member?.nickname || message.author.displayName;
		const proxiedMessage = await webhook.send({
			content: message.content,
			username: displayName,
			avatarURL: message.author.displayAvatarURL(),
			files: files,
			components: [row],
			allowedMentions: { parse: [] },
		});
		console.log(`[代理投稿] Webhook送信成功: MessageID=${messageId}, WebhookMessageID=${proxiedMessage.id}`);

		// 元のメッセージを削除
		await message.delete();

		// 削除情報を保存
		deletedMessageInfo.set(proxiedMessage.id, {
			content: message.content,
			author: message.author,
			attachments: Array.from(message.attachments.values()),
			channel: message.channel,
			originalMessageId: message.id,
			timestamp: Date.now(),
		});

		// クールダウンを更新
		messageProxyCooldowns.set(message.author.id, Date.now());
	}
}

module.exports = {
	clientReady,
	messageCreate,
	deletedMessageInfo,
};
