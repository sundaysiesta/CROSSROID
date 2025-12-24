const { EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { updateRomecoin, getRomecoin } = require('./romecoin');
const { CURRENT_GENERATION_ROLE_ID } = require('../constants');
const { getData, updateData } = require('./dataAccess');

const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';
const DAILY_DATA_FILE = path.join(__dirname, '..', 'daily_data.json');
const SERVER_BOOSTER_ROLE_ID = '1433804919315628032';

// 日本時間で今日の日付キーを取得
function getTodayKey() {
	const now = new Date();
	const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
	const y = jst.getFullYear();
	const m = String(jst.getMonth() + 1).padStart(2, '0');
	const d = String(jst.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

// 日本時間で昨日の日付キーを取得
function getYesterdayKey() {
	const now = new Date();
	const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
	jst.setDate(jst.getDate() - 1);
	const y = jst.getFullYear();
	const m = String(jst.getMonth() + 1).padStart(2, '0');
	const d = String(jst.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

// データ読み込み
function loadDailyData() {
	if (fs.existsSync(DAILY_DATA_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(DAILY_DATA_FILE, 'utf8'));
		} catch (e) {
			console.error('[Daily] データ読み込みエラー:', e);
			return {};
		}
	}
	return {};
}

// データ保存
function saveDailyData(data) {
	try {
		fs.writeFileSync(DAILY_DATA_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error('[Daily] データ保存エラー:', e);
	}
}

// 連続ログインボーナスを計算
function calculateStreakBonus(streak) {
	if (streak >= 30) return 500; // 30日以上: +500
	if (streak >= 14) return 300; // 14日以上: +300
	if (streak >= 7) return 200;  // 7日以上: +200
	if (streak >= 3) return 100;  // 3日以上: +100
	return 0; // 3日未満: ボーナスなし
}

async function handleDaily(interaction, client) {
	try {
		// 既に応答済みの場合は処理をスキップ
		if (interaction.replied || interaction.deferred) {
			return;
		}

		// 世代ロールチェック
		const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
		const member = interaction.member;
		const hasGenerationRole =
			member.roles.cache.some((r) => romanRegex.test(r.name)) ||
			member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

		if (!hasGenerationRole) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('デイリーログインボーナスを受け取るには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const userId = interaction.user.id;
		const todayKey = getTodayKey();
		const yesterdayKey = getYesterdayKey();

		// データ読み込み（Notion連携対応）
		const data = loadDailyData();
		const userData = await getData(userId, data, {
			lastLogin: null,
			totalDays: 0,
			streak: 0,
		});

		// 今日既にログインしているかチェック
		if (userData.lastLogin === todayKey) {
			if (!interaction.replied && !interaction.deferred) {
				const embed = new EmbedBuilder()
					.setTitle('⏰ 本日は既にログインボーナスを受け取っています')
					.setDescription(
						`**通算ログイン日数:** ${userData.totalDays}日\n**連続ログイン:** ${userData.streak}日`
					)
					.setColor(0xffa500)
					.setTimestamp();

				return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
			}
			return;
		}

		// 連続ログインの計算
		let newStreak = 1;
		if (userData.lastLogin === yesterdayKey) {
			// 昨日ログインしていた場合、連続ログインを継続
			newStreak = userData.streak + 1;
		} else if (userData.lastLogin && userData.lastLogin !== todayKey) {
			// 昨日ログインしていない場合、連続ログインをリセット
			newStreak = 1;
		}

		// 通算ログイン日数を更新
		const newTotalDays = userData.totalDays + 1;

		// 基本報酬を決定
		const isBooster = member && member.roles.cache.has(SERVER_BOOSTER_ROLE_ID);
		const baseReward = isBooster ? 1000 : 500;

		// 連続ログインボーナスを計算
		const streakBonus = calculateStreakBonus(newStreak);
		const totalReward = baseReward + streakBonus;

		// ロメコインを追加
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) + totalReward),
			{
				log: true,
				client: client,
				reason: `デイリーログインボーナス${streakBonus > 0 ? ` (連続${newStreak}日ボーナス+${streakBonus})` : ''}`,
				metadata: {
					commandName: 'daily',
					isBooster: isBooster,
					streak: newStreak,
					streakBonus: streakBonus,
				},
			}
		);

		// データを更新（Notion連携対応）
		userData.lastLogin = todayKey;
		userData.totalDays = newTotalDays;
		userData.streak = newStreak;
		await updateData(userId, data, () => userData);
		saveDailyData(data);

		// 結果を表示
		const rewardText = isBooster 
			? `**基本報酬:** ${ROMECOIN_EMOJI}1,000 (サーバーブースター)`
			: `**基本報酬:** ${ROMECOIN_EMOJI}500 (一般ロメダ民)`;

		const bonusText = streakBonus > 0
			? `\n**連続ログインボーナス:** ${ROMECOIN_EMOJI}${streakBonus} (${newStreak}日連続)`
			: '';

		const embed = new EmbedBuilder()
			.setTitle('🎁 デイリーログインボーナス')
			.setDescription(
				`${rewardText}${bonusText}\n\n**合計獲得:** ${ROMECOIN_EMOJI}${totalReward.toLocaleString()}\n\n**通算ログイン日数:** ${newTotalDays}日\n**連続ログイン:** ${newStreak}日`
			)
			.setColor(0x00ff00)
			.setTimestamp();

		if (interaction.replied || interaction.deferred) {
			return;
		}

		await interaction.reply({ embeds: [embed] }).catch((error) => {
			// Unknown interactionエラー（コード10062, 40060）は無視
			if (error.code !== 10062 && error.code !== 40060) {
				console.error('[Daily] 応答エラー:', error);
			}
		});
	} catch (error) {
		// Unknown interactionエラー（コード10062, 40060）は無視
		if (error.code === 10062 || error.code === 40060) {
			return;
		}
		console.error('[Daily] エラー:', error);
		if (!interaction.replied && !interaction.deferred) {
			try {
				await interaction.reply({
					content: 'エラーが発生しました。',
					flags: [MessageFlags.Ephemeral],
				}).catch(() => {});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

module.exports = {
	handleDaily,
};

