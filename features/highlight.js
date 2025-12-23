const { EmbedBuilder } = require('discord.js');
const { HIGHLIGHT_CHANNEL_ID } = require('../constants');

const highlightedMessages = new Set();

function setup(client) {
	// ハイライト機能：リアクションが5つ以上ついたメッセージ
	client.on('messageReactionAdd', async (reaction, user) => {
		try {
			if (user.bot) return;

			const message = reaction.message;
			if (message.author.bot) return;
			if (highlightedMessages.has(message.id)) return;

			const totalReactions = Array.from(message.reactions.cache.values()).reduce(
				(sum, reaction) => sum + reaction.count,
				0
			);

			if (totalReactions >= 5) {
				highlightedMessages.add(message.id);

				const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
				if (highlightChannel) {
					const embed = new EmbedBuilder()
						.setTitle('✨ ハイライト')
						.setDescription(`[メッセージにジャンプ](${message.url})`)
						.addFields(
							{ name: 'チャンネル', value: message.channel.toString(), inline: true },
							{ name: '投稿者', value: message.author.toString(), inline: true },
							{ name: 'リアクション数', value: totalReactions.toString(), inline: true }
						)
						.setColor(0xffb6c1)
						.setTimestamp(new Date())
						.setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

					let content = message.content || '';
					if (content.length > 200) {
						content = content.slice(0, 197) + '...';
					}
					if (content) {
						embed.addFields({ name: '内容', value: content, inline: false });
					}

					if (message.attachments.size > 0) {
						const attachment = message.attachments.first();
						if (attachment) {
							embed.setImage(attachment.url);
						}
					}

					await highlightChannel.send({ embeds: [embed] });
					console.log(`ハイライトを投稿しました: ${message.id} (${totalReactions}リアクション)`);
				}
			}
		} catch (error) {
			console.error('ハイライト機能でエラー:', error);
		}
	});

	// リアクション削除時の処理
	client.on('messageReactionRemove', async (reaction, user) => {
		try {
			if (user.bot) return;
			const message = reaction.message;
			if (message.author.bot) return;

			const totalReactions = Array.from(message.reactions.cache.values()).reduce(
				(sum, reaction) => sum + reaction.count,
				0
			);

			if (totalReactions < 5 && highlightedMessages.has(message.id)) {
				highlightedMessages.delete(message.id);
				console.log(`ハイライト済みフラグをリセットしました: ${message.id}`);
			}
		} catch (error) {
			console.error('ハイライト機能（リアクション削除）でエラー:', error);
		}
	});
}

module.exports = { setup };
