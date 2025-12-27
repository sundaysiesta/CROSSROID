const { EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { updateRomecoin, getRomecoin } = require('./romecoin');
const { getData, updateData, migrateData, getDataKey } = require('./dataAccess');
const { CURRENT_GENERATION_ROLE_ID, CLUB_CATEGORY_IDS } = require('../constants');

const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';
const CLUB_INVESTMENT_DATA_FILE = path.join(__dirname, '..', 'club_investment_data.json');

// ヒサメbot API設定
const HISAME_BOT_API_URL = process.env.HISAME_BOT_API_URL || 'http://localhost:3000';
const HISAME_BOT_API_TOKEN = process.env.CLUB_INVESTMENT_API_TOKEN || process.env.CROSSROID_API_TOKEN || process.env.API_TOKEN;

// 基準アクティブポイント（動的に計算される）
let BASE_ACTIVITY_POINT = 10000; // デフォルト値（計算失敗時のフォールバック）
let BASE_ACTIVITY_POINT_CACHE = {
	value: 10000,
	lastUpdated: 0,
};
const BASE_ACTIVITY_POINT_CACHE_DURATION = 60 * 60 * 1000; // 1時間キャッシュ

// データ読み込み
function loadClubInvestmentData() {
	if (fs.existsSync(CLUB_INVESTMENT_DATA_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(CLUB_INVESTMENT_DATA_FILE, 'utf8'));
		} catch (e) {
			console.error('[ClubInvestment] データ読み込みエラー:', e);
			return {};
		}
	}
	return {};
}

// データ保存
function saveClubInvestmentData(data) {
	try {
		fs.writeFileSync(CLUB_INVESTMENT_DATA_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error('[ClubInvestment] データ保存エラー:', e);
	}
}

// ヒサメbotからアクティブポイントを取得（リトライ機能付き）
async function getClubActivityPoint(channelId, retries = 5) {
	const url = `${HISAME_BOT_API_URL}/api/club/activity/${channelId}`;
	
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await axios.get(url, {
				headers: {
					'x-api-token': HISAME_BOT_API_TOKEN,
				},
				timeout: 30000, // タイムアウトを30秒に延長
			});

			const data = response.data;
			return {
				activityPoint: data.activityPoint || 0,
				rank: data.rank || null,
				activeMemberCount: data.activeMemberCount || 0,
				weeklyMessageCount: data.weeklyMessageCount || 0,
				lastUpdated: data.lastUpdated || Date.now(),
			};
		} catch (error) {
			if (error.response?.status === 404) {
				console.log(`[ClubInvestment] 部活が見つかりません: ${channelId}`);
				return null;
			}
			
			// タイムアウトエラーの場合
			if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
				if (attempt < retries) {
					const delay = attempt * 2000; // 2秒、4秒、6秒、8秒、10秒と段階的に遅延
					console.warn(`[ClubInvestment] アクティブポイント取得タイムアウト (channelId: ${channelId}, 試行 ${attempt}/${retries}), ${delay}ms後にリトライ...`);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				} else {
					console.warn(`[ClubInvestment] アクティブポイント取得タイムアウト (channelId: ${channelId}): 最大リトライ回数に達しました。このチャンネルをスキップします。`);
					// タイムアウト時はnullを返して処理を続行（他のチャンネルの取得を妨げない）
					return null;
				}
			}
			
			// ネットワークエラーの場合（ECONNREFUSED, ENOTFOUNDなど）
			if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
				if (attempt < retries) {
					const delay = attempt * 2000;
					console.warn(`[ClubInvestment] ネットワークエラー (channelId: ${channelId}, 試行 ${attempt}/${retries}), ${delay}ms後にリトライ...`);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				} else {
					console.warn(`[ClubInvestment] ネットワークエラー (channelId: ${channelId}): 最大リトライ回数に達しました。このチャンネルをスキップします。`);
					return null;
				}
			}
			
			// その他のエラー
			console.error(`[ClubInvestment] アクティブポイント取得エラー (channelId: ${channelId}):`, error.message);
			return null;
		}
	}
	
	return null;
}

// 全部活のアクティブポイントを取得して基準値を計算（平均値または中央値）
async function calculateBaseActivityPoint(client) {
	try {
		// キャッシュをチェック
		const now = Date.now();
		if (BASE_ACTIVITY_POINT_CACHE.lastUpdated > 0 && 
			(now - BASE_ACTIVITY_POINT_CACHE.lastUpdated) < BASE_ACTIVITY_POINT_CACHE_DURATION) {
			BASE_ACTIVITY_POINT = BASE_ACTIVITY_POINT_CACHE.value;
			return BASE_ACTIVITY_POINT;
		}

		// 全部活チャンネルを取得
		const guild = client.guilds.cache.first();
		if (!guild) {
			console.warn('[ClubInvestment] ギルドが見つかりません。デフォルト値を使用します。');
			return BASE_ACTIVITY_POINT;
		}

		const activityPoints = [];
		const allChannels = [];
		
		// 各カテゴリから部活チャンネルを取得
		for (const categoryId of CLUB_CATEGORY_IDS) {
			try {
				const category = await guild.channels.fetch(categoryId);
				if (!category || category.type !== 4) continue; // カテゴリでない場合はスキップ
				
				// カテゴリ内の全チャンネルを取得
				const channels = category.children.cache.filter(ch => ch.type === 0); // テキストチャンネルのみ
				allChannels.push(...channels.values());
			} catch (error) {
				console.error(`[ClubInvestment] カテゴリ ${categoryId} の取得エラー:`, error.message);
			}
		}

		// 並行処理を制限（同時に2つまで、タイムアウト対策）
		const CONCURRENT_LIMIT = 2;
		for (let i = 0; i < allChannels.length; i += CONCURRENT_LIMIT) {
			const batch = allChannels.slice(i, i + CONCURRENT_LIMIT);
			const promises = batch.map(async (channel) => {
				try {
					const activityData = await getClubActivityPoint(channel.id);
					if (activityData && activityData.activityPoint > 0) {
						return activityData.activityPoint;
					}
				} catch (error) {
					console.error(`[ClubInvestment] チャンネル ${channel.id} のアクティブポイント取得エラー:`, error.message);
				}
				return null;
			});
			
			const results = await Promise.allSettled(promises);
			for (const result of results) {
				if (result.status === 'fulfilled' && result.value !== null) {
					activityPoints.push(result.value);
				} else if (result.status === 'rejected') {
					console.error(`[ClubInvestment] チャンネル処理エラー:`, result.reason);
				}
			}
			
			// バッチ間で少し待機（API負荷を軽減、タイムアウト対策）
			if (i + CONCURRENT_LIMIT < allChannels.length) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
		}

		if (activityPoints.length === 0) {
			console.warn('[ClubInvestment] アクティブポイントを取得できませんでした。デフォルト値を使用します。');
			return BASE_ACTIVITY_POINT;
		}

		// 平均値と中央値を計算
		const sum = activityPoints.reduce((a, b) => a + b, 0);
		const average = sum / activityPoints.length;
		
		// 中央値を計算
		const sorted = [...activityPoints].sort((a, b) => a - b);
		const median = sorted.length % 2 === 0
			? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
			: sorted[Math.floor(sorted.length / 2)];

		// 中央値を使用（より安定した値）
		const baseValue = Math.round(median);
		
		BASE_ACTIVITY_POINT = baseValue;
		BASE_ACTIVITY_POINT_CACHE = {
			value: baseValue,
			lastUpdated: now,
		};

		console.log(`[ClubInvestment] 基準アクティブポイントを更新: ${baseValue} (平均: ${Math.round(average)}, 中央値: ${baseValue}, 部活数: ${activityPoints.length})`);
		
		return BASE_ACTIVITY_POINT;
	} catch (error) {
		console.error('[ClubInvestment] 基準アクティブポイント計算エラー:', error);
		return BASE_ACTIVITY_POINT; // エラー時は既存の値を使用
	}
}

// 基準アクティブポイントを取得（キャッシュ付き）
async function getBaseActivityPoint(client) {
	// キャッシュが有効な場合はそれを使用
	const now = Date.now();
	if (BASE_ACTIVITY_POINT_CACHE.lastUpdated > 0 && 
		(now - BASE_ACTIVITY_POINT_CACHE.lastUpdated) < BASE_ACTIVITY_POINT_CACHE_DURATION) {
		return BASE_ACTIVITY_POINT_CACHE.value;
	}
	
	// キャッシュが無効な場合は再計算
	return await calculateBaseActivityPoint(client);
}

// 株価を計算
async function calculateStockPrice(clubData, activityPoint, client = null) {
	const totalCapital = clubData.initialCapital + clubData.totalInvestment;
	
	// 基準アクティブポイントを取得（clientが提供されている場合）
	let baseActivityPoint = clubData.baseActivityPoint || BASE_ACTIVITY_POINT;
	if (client) {
		try {
			baseActivityPoint = await getBaseActivityPoint(client);
		} catch (error) {
			console.error('[ClubInvestment] 基準アクティブポイント取得エラー:', error);
			// エラー時は既存の値を使用
		}
	}
	
	const activityRatio = activityPoint / baseActivityPoint;
	
	if (clubData.totalShares === 0) {
		return 1.0; // 初期株価
	}
	
	const stockPrice = (totalCapital * activityRatio) / clubData.totalShares;
	return Math.max(0.001, stockPrice); // 最小値0.001
}

// 部活投資データを初期化
async function initializeClubData(channelId, client = null) {
	const data = loadClubInvestmentData();
	if (!data[channelId]) {
		// 基準アクティブポイントを取得（clientが提供されている場合）
		let baseActivityPoint = BASE_ACTIVITY_POINT;
		if (client) {
			try {
				baseActivityPoint = await getBaseActivityPoint(client);
			} catch (error) {
				console.error('[ClubInvestment] 基準アクティブポイント取得エラー:', error);
			}
		}
		
		data[channelId] = {
			initialCapital: 10000, // 部活作成時の10,000ロメコイン
			totalInvestment: 0,
			totalShares: 10000, // 初期株式数
			baseActivityPoint: baseActivityPoint,
			investors: {},
			createdAt: Date.now(),
			lastUpdated: Date.now(),
		};
		saveClubInvestmentData(data);
	}
	return data[channelId];
}

// 部活情報を表示
async function handleClubInvestInfo(interaction, client) {
	try {
		// 早期にdeferReplyを実行（タイムアウトを防ぐ）
		try {
			if (!interaction.deferred && !interaction.replied) {
				await interaction.deferReply();
			}
		} catch (deferErr) {
			if (deferErr.code === 10062 || deferErr.code === 40060) {
				return; // インタラクションがタイムアウト
			}
			throw deferErr;
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
				.setDescription('部活投資機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
		}

		const channel = interaction.options.getChannel('channel') || interaction.channel;
		
		// 部活チャンネルかチェック
		// channel.parentIdがnullの場合や、型が一致しない場合を考慮
		let parentId = null;
		if (channel.parentId !== null && channel.parentId !== undefined) {
			parentId = String(channel.parentId);
		}
		
		// CLUB_CATEGORY_IDSの各要素も文字列として比較
		const parentIdInList = parentId && CLUB_CATEGORY_IDS.some(catId => String(catId) === parentId);
		
		if (!parentId || !parentIdInList) {
			console.log(`[ClubInvestment] 部活チャンネルチェック失敗: channelId=${channel.id}, channelName=${channel.name}, parentId=${parentId} (type: ${typeof parentId}), CLUB_CATEGORY_IDS=${JSON.stringify(CLUB_CATEGORY_IDS.map(id => String(id)))}`);
			return interaction.editReply({
				content: '部活チャンネルで実行してください。',
			});
		}

		// 部活データを初期化
		const clubData = await initializeClubData(channel.id, client);

		// 基準アクティブポイントを計算（初回のみ、またはキャッシュが無効な場合）
		const baseActivityPoint = await getBaseActivityPoint(client);

		// アクティブポイントを取得
		const activityData = await getClubActivityPoint(channel.id);
		const activityPoint = activityData ? activityData.activityPoint : 0;

		// 株価を計算
		const stockPrice = await calculateStockPrice(clubData, activityPoint, client);

		// 株価変動率を計算（基準アクティブポイントでの株価）
		const basePrice = await calculateStockPrice(clubData, baseActivityPoint, client);
		const priceChangeRate = ((stockPrice - basePrice) / basePrice) * 100;

		const embed = new EmbedBuilder()
			.setTitle(`📊 ${channel.name} の投資情報`)
			.setColor(0x00ff00)
			.addFields(
				{
					name: '現在の株価',
					value: `${ROMECOIN_EMOJI}${stockPrice.toFixed(3)}/株`,
					inline: true,
				},
				{
					name: '株価変動率',
					value: `${priceChangeRate >= 0 ? '+' : ''}${priceChangeRate.toFixed(2)}%`,
					inline: true,
				},
				{
					name: '発行済み株式数',
					value: `${clubData.totalShares.toLocaleString()}株`,
					inline: true,
				},
				{
					name: '投資総額',
					value: `${ROMECOIN_EMOJI}${clubData.totalInvestment.toLocaleString()}`,
					inline: true,
				},
				{
					name: 'アクティブポイント',
					value: `${activityPoint.toLocaleString()}ポイント`,
					inline: true,
				},
				{
					name: 'ランキング',
					value: activityData && activityData.rank ? `${activityData.rank}位` : '不明',
					inline: true,
				}
			)
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	} catch (error) {
		console.error('[ClubInvestment] 情報取得エラー:', error);
		if (interaction.deferred || interaction.replied) {
			try {
				await interaction.editReply({
					content: `❌ エラー: ${error.message}`,
				});
			} catch (e) {
				// エラーを無視
			}
		} else {
			try {
				await interaction.reply({
					content: `❌ エラー: ${error.message}`,
					flags: MessageFlags.Ephemeral,
				});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

// 部活に投資（株式購入）
async function handleClubInvestBuy(interaction, client) {
	try {
		// 早期にdeferReplyを実行（タイムアウトを防ぐ）
		try {
			if (!interaction.deferred && !interaction.replied) {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			}
		} catch (deferErr) {
			if (deferErr.code === 10062 || deferErr.code === 40060) {
				return; // インタラクションがタイムアウト
			}
			throw deferErr;
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
				.setDescription('部活投資機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
		}

		const channel = interaction.options.getChannel('channel') || interaction.channel;
		const amount = interaction.options.getInteger('amount');

		// 部活チャンネルかチェック
		// channel.parentIdがnullの場合や、型が一致しない場合を考慮
		let parentId = null;
		if (channel.parentId !== null && channel.parentId !== undefined) {
			parentId = String(channel.parentId);
		}
		
		// CLUB_CATEGORY_IDSの各要素も文字列として比較
		const parentIdInList = parentId && CLUB_CATEGORY_IDS.some(catId => String(catId) === parentId);
		
		if (!parentId || !parentIdInList) {
			console.log(`[ClubInvestment] 部活チャンネルチェック失敗: channelId=${channel.id}, channelName=${channel.name}, parentId=${parentId} (type: ${typeof parentId}), CLUB_CATEGORY_IDS=${JSON.stringify(CLUB_CATEGORY_IDS.map(id => String(id)))}`);
			return interaction.editReply({
				content: '部活チャンネルで実行してください。',
			});
		}

		if (!amount || amount <= 0) {
			return interaction.editReply({
				content: '有効な投資額（1以上）を指定してください。',
			});
		}

		const userId = interaction.user.id;
		const currentBalance = await getRomecoin(userId);
		
		if (currentBalance < amount) {
			return interaction.editReply({
				content: `ロメコインが不足しています。\n現在の所持: ${ROMECOIN_EMOJI}${currentBalance.toLocaleString()}\n必要な額: ${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
			});
		}

		// データを読み込み
		const data = loadClubInvestmentData();
		const clubData = await initializeClubData(channel.id, client);

		// アクティブポイントを取得
		const activityData = await getClubActivityPoint(channel.id);
		const baseActivityPoint = await getBaseActivityPoint(client);
		const activityPoint = activityData ? activityData.activityPoint : baseActivityPoint;

		// 現在の株価を計算
		const stockPrice = await calculateStockPrice(clubData, activityPoint, client);

		// 購入可能な株式数を計算
		const sharesToBuy = Math.floor(amount / stockPrice);
		
		if (sharesToBuy <= 0) {
			return interaction.editReply({
				content: `投資額が少なすぎます。最低でも${ROMECOIN_EMOJI}${Math.ceil(stockPrice)}が必要です。`,
			});
		}

		// ロメコインを減額
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) - amount),
			{
				log: true,
				client: client,
				reason: `部活投資: ${channel.name} へ`,
				metadata: {
					commandName: 'club_invest_buy',
					channelId: channel.id,
				},
			}
		);

		// 投資データを更新
		const investorKey = await getData(userId, clubData.investors, {
			shares: 0,
			totalInvested: 0,
			averagePrice: stockPrice,
		});

		const previousShares = investorKey.shares;
		const previousInvested = investorKey.totalInvested;
		const newShares = previousShares + sharesToBuy;
		const newTotalInvested = previousInvested + amount;
		const newAveragePrice = newTotalInvested / newShares;

		investorKey.shares = newShares;
		investorKey.totalInvested = newTotalInvested;
		investorKey.averagePrice = newAveragePrice;

		await updateData(userId, clubData.investors, () => investorKey);
		
		clubData.totalInvestment += amount;
		clubData.totalShares += sharesToBuy;
		clubData.lastUpdated = Date.now();

		data[channel.id] = clubData;
		saveClubInvestmentData(data);

		const embed = new EmbedBuilder()
			.setTitle('✅ 投資完了')
			.setDescription(`${channel.name} に ${ROMECOIN_EMOJI}${amount.toLocaleString()} を投資しました。`)
			.addFields(
				{
					name: '購入株式数',
					value: `${sharesToBuy.toLocaleString()}株`,
					inline: true,
				},
				{
					name: '購入単価',
					value: `${ROMECOIN_EMOJI}${stockPrice.toFixed(3)}/株`,
					inline: true,
				},
				{
					name: '保有株式数',
					value: `${newShares.toLocaleString()}株`,
					inline: true,
				},
				{
					name: '平均取得価格',
					value: `${ROMECOIN_EMOJI}${newAveragePrice.toFixed(3)}/株`,
					inline: true,
				},
				{
					name: '現在の評価額',
					value: `${ROMECOIN_EMOJI}${(newShares * stockPrice).toFixed(0)}`,
					inline: true,
				}
			)
			.setColor(0x00ff00)
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	} catch (error) {
		console.error('[ClubInvestment] 投資エラー:', error);
		if (interaction.deferred || interaction.replied) {
			try {
				await interaction.editReply({
					content: `❌ エラー: ${error.message}`,
				});
			} catch (e) {
				// エラーを無視
			}
		} else {
			try {
				await interaction.reply({
					content: `❌ エラー: ${error.message}`,
					flags: MessageFlags.Ephemeral,
				});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

// 株式を売却
async function handleClubInvestSell(interaction, client) {
	try {
		// 早期にdeferReplyを実行（タイムアウトを防ぐ）
		try {
			if (!interaction.deferred && !interaction.replied) {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			}
		} catch (deferErr) {
			if (deferErr.code === 10062 || deferErr.code === 40060) {
				return; // インタラクションがタイムアウト
			}
			throw deferErr;
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
				.setDescription('部活投資機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
		}

		const channel = interaction.options.getChannel('channel') || interaction.channel;
		const shares = interaction.options.getInteger('shares');

		// 部活チャンネルかチェック
		// channel.parentIdがnullの場合や、型が一致しない場合を考慮
		let parentId = null;
		if (channel.parentId !== null && channel.parentId !== undefined) {
			parentId = String(channel.parentId);
		}
		
		// CLUB_CATEGORY_IDSの各要素も文字列として比較
		const parentIdInList = parentId && CLUB_CATEGORY_IDS.some(catId => String(catId) === parentId);
		
		if (!parentId || !parentIdInList) {
			console.log(`[ClubInvestment] 部活チャンネルチェック失敗: channelId=${channel.id}, channelName=${channel.name}, parentId=${parentId} (type: ${typeof parentId}), CLUB_CATEGORY_IDS=${JSON.stringify(CLUB_CATEGORY_IDS.map(id => String(id)))}`);
			return interaction.editReply({
				content: '部活チャンネルで実行してください。',
			});
		}

		if (!shares || shares <= 0) {
			return interaction.editReply({
				content: '有効な株式数（1以上）を指定してください。',
			});
		}

		const userId = interaction.user.id;

		// データを読み込み
		const data = loadClubInvestmentData();
		const clubData = await initializeClubData(channel.id, client);

		// 投資者データを取得
		const investorKey = await getData(userId, clubData.investors, {
			shares: 0,
			totalInvested: 0,
			averagePrice: 0,
		});

		if (investorKey.shares < shares) {
			return interaction.editReply({
				content: `保有株式数が不足しています。\n保有株式数: ${investorKey.shares.toLocaleString()}株\n売却株式数: ${shares.toLocaleString()}株`,
			});
		}

		// アクティブポイントを取得
		const activityData = await getClubActivityPoint(channel.id);
		const baseActivityPoint = await getBaseActivityPoint(client);
		const activityPoint = activityData ? activityData.activityPoint : baseActivityPoint;

		// 現在の株価を計算
		const stockPrice = await calculateStockPrice(clubData, activityPoint, client);

		// 売却金額を計算
		const sellAmount = Math.floor(shares * stockPrice);

		// ロメコインを増額
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) + sellAmount),
			{
				log: true,
				client: client,
				reason: `部活投資売却: ${channel.name} から`,
				metadata: {
					commandName: 'club_invest_sell',
					channelId: channel.id,
				},
			}
		);

		// 投資データを更新
		const previousShares = investorKey.shares;
		const previousInvested = investorKey.totalInvested;
		const newShares = previousShares - shares;
		const newTotalInvested = previousInvested - (shares * investorKey.averagePrice);
		const newAveragePrice = newShares > 0 ? newTotalInvested / newShares : 0;

		if (newShares > 0) {
			investorKey.shares = newShares;
			investorKey.totalInvested = newTotalInvested;
			investorKey.averagePrice = newAveragePrice;
			await updateData(userId, clubData.investors, () => investorKey);
		} else {
			// 全株式を売却した場合は投資者データを削除
			const investorDataKey = await getDataKey(userId);
			delete clubData.investors[investorDataKey];
		}
		
		clubData.totalInvestment -= (shares * investorKey.averagePrice);
		clubData.totalShares -= shares;
		clubData.lastUpdated = Date.now();

		data[channel.id] = clubData;
		saveClubInvestmentData(data);

		// 損益を計算
		const profit = sellAmount - (shares * investorKey.averagePrice);
		const profitRate = ((profit / (shares * investorKey.averagePrice)) * 100);

		const embed = new EmbedBuilder()
			.setTitle('✅ 売却完了')
			.setDescription(`${channel.name} の株式 ${shares.toLocaleString()}株 を売却しました。`)
			.addFields(
				{
					name: '売却金額',
					value: `${ROMECOIN_EMOJI}${sellAmount.toLocaleString()}`,
					inline: true,
				},
				{
					name: '売却単価',
					value: `${ROMECOIN_EMOJI}${stockPrice.toFixed(3)}/株`,
					inline: true,
				},
				{
					name: '損益',
					value: `${profit >= 0 ? '+' : ''}${ROMECOIN_EMOJI}${profit.toLocaleString()} (${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%)`,
					inline: true,
				},
				{
					name: '残り保有株式数',
					value: `${newShares.toLocaleString()}株`,
					inline: true,
				}
			)
			.setColor(profit >= 0 ? 0x00ff00 : 0xff0000)
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	} catch (error) {
		console.error('[ClubInvestment] 売却エラー:', error);
		if (interaction.deferred || interaction.replied) {
			try {
				await interaction.editReply({
					content: `❌ エラー: ${error.message}`,
				});
			} catch (e) {
				// エラーを無視
			}
		} else {
			try {
				await interaction.reply({
					content: `❌ エラー: ${error.message}`,
					flags: MessageFlags.Ephemeral,
				});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

// ポートフォリオを表示
async function handleClubInvestPortfolio(interaction, client) {
	try {
		// 世代ロールチェック
		const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
		const member = interaction.member;
		const hasGenerationRole =
			member.roles.cache.some((r) => romanRegex.test(r.name)) ||
			member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

		if (!hasGenerationRole) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('部活投資機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const userId = interaction.user.id;
		const data = loadClubInvestmentData();

		// 投資している部活を取得
		const investments = [];
		for (const [channelId, clubData] of Object.entries(data)) {
			const investorKey = await getData(userId, clubData.investors, {
				shares: 0,
				totalInvested: 0,
				averagePrice: 0,
			});

			if (investorKey.shares > 0) {
				// アクティブポイントを取得
				const activityData = await getClubActivityPoint(channelId);
				const baseActivityPoint = await getBaseActivityPoint(client);
				const activityPoint = activityData ? activityData.activityPoint : baseActivityPoint;

				// 現在の株価を計算
				const stockPrice = await calculateStockPrice(clubData, activityPoint, client);

				// 評価額と損益を計算
				const currentValue = investorKey.shares * stockPrice;
				const profit = currentValue - investorKey.totalInvested;
				const profitRate = ((profit / investorKey.totalInvested) * 100);

				// チャンネル名を取得
				const channel = await client.channels.fetch(channelId).catch(() => null);
				const channelName = channel ? channel.name : `チャンネルID: ${channelId}`;

				investments.push({
					channelId,
					channelName,
					shares: investorKey.shares,
					totalInvested: investorKey.totalInvested,
					currentValue,
					profit,
					profitRate,
					stockPrice,
				});
			}
		}

		if (investments.length === 0) {
			return interaction.reply({
				content: '投資している部活がありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 総評価額と総損益を計算
		const totalInvested = investments.reduce((sum, inv) => sum + inv.totalInvested, 0);
		const totalCurrentValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
		const totalProfit = totalCurrentValue - totalInvested;
		const totalProfitRate = ((totalProfit / totalInvested) * 100);

		// ポートフォリオを表示
		const portfolioText = investments
			.sort((a, b) => b.currentValue - a.currentValue)
			.map((inv, index) => {
				const profitEmoji = inv.profit >= 0 ? '📈' : '📉';
				return `${index + 1}. **${inv.channelName}**\n` +
					`   保有: ${inv.shares.toLocaleString()}株 (${ROMECOIN_EMOJI}${inv.stockPrice.toFixed(3)}/株)\n` +
					`   投資額: ${ROMECOIN_EMOJI}${inv.totalInvested.toLocaleString()}\n` +
					`   評価額: ${ROMECOIN_EMOJI}${inv.currentValue.toFixed(0)}\n` +
					`   損益: ${profitEmoji} ${inv.profit >= 0 ? '+' : ''}${ROMECOIN_EMOJI}${inv.profit.toFixed(0)} (${inv.profitRate >= 0 ? '+' : ''}${inv.profitRate.toFixed(2)}%)`;
			})
			.join('\n\n');

		const embed = new EmbedBuilder()
			.setTitle('💼 投資ポートフォリオ')
			.setDescription(portfolioText)
			.addFields(
				{
					name: '総投資額',
					value: `${ROMECOIN_EMOJI}${totalInvested.toLocaleString()}`,
					inline: true,
				},
				{
					name: '総評価額',
					value: `${ROMECOIN_EMOJI}${totalCurrentValue.toFixed(0)}`,
					inline: true,
				},
				{
					name: '総損益',
					value: `${totalProfit >= 0 ? '📈' : '📉'} ${totalProfit >= 0 ? '+' : ''}${ROMECOIN_EMOJI}${totalProfit.toFixed(0)} (${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(2)}%)`,
					inline: true,
				}
			)
			.setColor(totalProfit >= 0 ? 0x00ff00 : 0xff0000)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[ClubInvestment] ポートフォリオ取得エラー:', error);
		if (!interaction.replied && !interaction.deferred) {
			try {
				await interaction.reply({
					content: 'エラーが発生しました。',
					flags: [MessageFlags.Ephemeral],
				});
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

module.exports = {
	handleClubInvestInfo,
	handleClubInvestBuy,
	handleClubInvestSell,
	handleClubInvestPortfolio,
	loadClubInvestmentData,
	saveClubInvestmentData,
	getClubActivityPoint,
	calculateStockPrice,
	calculateBaseActivityPoint,
	getBaseActivityPoint,
};

