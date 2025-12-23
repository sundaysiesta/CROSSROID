const { EmbedBuilder } = require('discord.js');
const { LEVEL_10_ROLE_ID, CURRENT_GENERATION_ROLE_ID, ALLOWED_ROLE_IDS, MAIN_CHANNEL_ID } = require('../constants');

const todayGenerationWinners = new Set();

function setup(client) {
	// レベル10ロール取得時の世代ロール付与処理
	client.on('guildMemberUpdate', async (oldMember, newMember) => {
		try {
			const hadLevel10Role = oldMember.roles.cache.has(LEVEL_10_ROLE_ID);
			const hasLevel10Role = newMember.roles.cache.has(LEVEL_10_ROLE_ID);

			if (!hadLevel10Role && hasLevel10Role) {
				console.log(`レベル10ロールが新しく追加されました: ${newMember.user.tag}`);

				const hasGenerationRole = newMember.roles.cache.some((role) => ALLOWED_ROLE_IDS.includes(role.id));

				if (!hasGenerationRole) {
					await newMember.roles.add(CURRENT_GENERATION_ROLE_ID);
					todayGenerationWinners.add(newMember.user.id);

					const mainChannel = client.channels.cache.get(MAIN_CHANNEL_ID);
					if (mainChannel) {
						const embed = new EmbedBuilder()
							.setTitle('🎉 第19世代おめでとうございます！')
							.setDescription(`${newMember.user} さんがレベル10に到達し、第19世代ロールを獲得しました！`)
							.setColor(0xffd700)
							.setThumbnail(newMember.user.displayAvatarURL())
							.addFields(
								{ name: '獲得したロール', value: `<@&${CURRENT_GENERATION_ROLE_ID}>`, inline: true },
								{ name: '世代', value: '第19世代', inline: true },
								{ name: 'レベル', value: '10', inline: true }
							)
							.setTimestamp(new Date())
							.setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

						await mainChannel.send({
							content: `🎊 ${newMember.user} さん、第19世代獲得おめでとうございます！🎊`,
							embeds: [embed],
						});
					}
				}
			}
		} catch (error) {
			console.error('世代ロール付与処理でエラーが発生しました:', error);
		}
	});

	// 日付が変わったときに世代獲得者リストをリセット
	const now = new Date();
	const japanTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
	const tomorrow = new Date(japanTime);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(0, 0, 0, 0);
	const msUntilMidnight = tomorrow.getTime() - japanTime.getTime();

	setTimeout(() => {
		todayGenerationWinners.clear();
		console.log('世代獲得者リストをリセットしました');

		// その後は24時間ごとにリセット
		setInterval(() => {
			todayGenerationWinners.clear();
			console.log('世代獲得者リストをリセットしました');
		}, 24 * 60 * 60 * 1000);
	}, msUntilMidnight);
}

module.exports = { setup };
