const { EmbedBuilder } = require('discord.js');
const { VC_CATEGORY_ID, VC_NOTIFY_THRESHOLDS, VC_NOTIFY_COOLDOWN_MS } = require('../constants');

// VC通知機能
const vcNotifyCooldowns = new Map(); // key: channelId_threshold, value: lastNotifyTime
const vcMemberCounts = new Map(); // key: channelId, value: { current: number, previous: number }

async function sendVCNotification(client, vc, memberCount, threshold) {
	try {
		const notifyChannel = client.channels.cache.get('1415336647284883528');
		if (!notifyChannel) return;

		const embed = new EmbedBuilder()
			.setTitle('🎤 VC人数通知')
			.setDescription(`**${vc.name}** の参加人数が **${threshold}人** を超えました！`)
			.addFields(
				{ name: '現在の参加人数', value: `${memberCount}人`, inline: true },
				{ name: 'VC', value: vc.toString(), inline: true },
				{ name: '閾値', value: `${threshold}人`, inline: true }
			)
			.setColor(0x00ff00) // 緑色
			.setTimestamp(new Date())
			.setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

		await notifyChannel.send({ embeds: [embed] });
		console.log(`VC通知を送信しました: ${vc.name} (${memberCount}人, 閾値: ${threshold}人)`);
	} catch (error) {
		console.error('VC通知送信でエラー:', error);
	}
}

async function checkAndNotifyVCThresholds(client) {
	try {
		const guild = client.guilds.cache.first();
		if (!guild) return;

		const vcCategory = guild.channels.cache.get(VC_CATEGORY_ID);
		if (!vcCategory || vcCategory.type !== 4) return;

		const voiceChannels = vcCategory.children.cache.filter(
			(ch) =>
				ch.type === 2 && // ボイスチャンネル
				ch.members &&
				ch.members.size > 0
		);

		for (const vc of voiceChannels.values()) {
			const currentCount = vc.members.size;
			const channelId = vc.id;

			// 前回の人数を取得
			const previousData = vcMemberCounts.get(channelId) || { current: 0, previous: 0 };
			const previousCount = previousData.current;

			// 現在の人数を更新
			vcMemberCounts.set(channelId, { current: currentCount, previous: previousCount, timestamp: Date.now() });

			// 閾値を超えた場合のみチェック（人数の増減に関係なく）
			for (const threshold of VC_NOTIFY_THRESHOLDS) {
				// 閾値を超えたかチェック（前回は閾値以下、今回は閾値超過）
				if (previousCount < threshold && currentCount >= threshold) {
					const cooldownKey = `${channelId}_${threshold}`;
					const lastNotify = vcNotifyCooldowns.get(cooldownKey) || 0;

					// クールダウンチェック
					if (Date.now() - lastNotify < VC_NOTIFY_COOLDOWN_MS) {
						continue;
					}

					// 通知を送信
					await sendVCNotification(client, vc, currentCount, threshold);

					// クールダウンを設定
					vcNotifyCooldowns.set(cooldownKey, Date.now());
				}
			}
		}
	} catch (error) {
		console.error('VC通知チェックでエラー:', error);
	}
}

// 定期的なクリーンアップ
function cleanup() {
	const oneHourAgo = Date.now() - 60 * 60 * 1000;

	// VC通知のクールダウンクリア
	for (const [cooldownKey, lastNotify] of vcNotifyCooldowns.entries()) {
		if (lastNotify < oneHourAgo) {
			vcNotifyCooldowns.delete(cooldownKey);
		}
	}

	// VC人数データのクリア（古いもの）
	for (const [channelId, data] of vcMemberCounts.entries()) {
		if (Date.now() - (data.timestamp || 0) > oneHourAgo) {
			vcMemberCounts.delete(channelId);
		}
	}
}

function setup(client) {
	// VC通知の定期実行（5分ごと）
	setInterval(async () => {
		try {
			await checkAndNotifyVCThresholds(client);
		} catch (error) {
			console.error('定期VC通知チェックでエラー:', error);
		}
	}, 5 * 60 * 1000);

	// 定期クリーンアップ (30分ごと)
	setInterval(cleanup, 30 * 60 * 1000);
}

module.exports = { setup };
