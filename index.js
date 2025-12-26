const {
	Client,
	GatewayIntentBits,
	EmbedBuilder,
	SlashCommandBuilder,
	ContextMenuCommandBuilder,
	ApplicationCommandType,
} = require('discord.js');
const express = require('express');

// 環境変数の読み込み（ローカル開発時のみ、他のモジュール読み込み前に実行）
if (process.env.NODE_ENV !== 'production') {
	try {
		require('dotenv').config();
		console.log('✅ .envファイルから環境変数を読み込みました');
	} catch (error) {
		console.error('⚠️ .envファイルの読み込みに失敗しました:', error.message);
	}
} else {
	console.log('🚀 本番環境で実行中（.envファイルは読み込みません）');
}

// Config & Constants
const { LEVEL_10_ROLE_ID, CURRENT_GENERATION_ROLE_ID, MAIN_CHANNEL_ID, ERRORLOG_CHANNEL_ID } = require('./constants');

// Features
const timeSignal = require('./features/timeSignal');
const vcNotify = require('./features/vcNotify');
const proxy = require('./features/proxy');
const highlight = require('./features/highlight');
const imageLog = require('./features/imageLog');
const roleAward = require('./features/roleAward');
const legacyMigration = require('./features/legacyMigration');
const persistence = require('./features/persistence');
const activityTracker = require('./features/activityTracker');
const abuseProtocol = require('./features/abuseProtocol');
const daily = require('./features/daily');
const bank = require('./features/bank');

// Command Handler
const { handleCommands } = require('./commands');
const romecoin = require('./features/romecoin');
const mahjong = require('./features/mahjong');

// Discordクライアントのインスタンスを作成
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildPresences,
	],
});

// Expressアプリのインスタンスを作成 (Uptime Robot用)
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
	res.send({ status: 'alive', uptime: `${client.uptime}ms`, ping: `${client.ws.ping}ms` });
});

// API認証ミドルウェア
const authenticateAPI = (req, res, next) => {
	const apiToken = process.env.API_TOKEN;
	if (!apiToken) {
		return res.status(500).json({ error: 'API_TOKENが設定されていません' });
	}

	const providedToken = req.headers['x-api-token'] || req.query.token;
	if (providedToken !== apiToken) {
		return res.status(401).json({ error: '認証に失敗しました' });
	}

	next();
};

// ロメコイン残高を取得
app.get('/api/romecoin/:userId', authenticateAPI, async (req, res) => {
	try {
		const userId = req.params.userId;
		console.log(`[API] ロメコイン取得リクエスト: userId=${userId}`);

		if (!userId || userId.trim() === '') {
			return res.status(400).json({ error: 'ユーザーIDが指定されていません' });
		}

		const balance = await romecoin.getRomecoin(userId);
		console.log(`[API] ロメコイン取得成功: userId=${userId}, balance=${balance}`);
		res.json({ userId, balance });
	} catch (error) {
		console.error('[API] ロメコイン取得エラー:', error);
		console.error('[API] エラースタック:', error.stack);
		res.status(500).json({
			error: 'ロメコインの取得に失敗しました',
			message: error.message,
			details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
		});
	}
});

// ロメコインを減らす
app.post('/api/romecoin/:userId/deduct', authenticateAPI, async (req, res) => {
	try {
		const userId = req.params.userId;
		const amountRaw = req.body.amount;
		
		// 数値の検証を強化
		if (typeof amountRaw !== 'number' && typeof amountRaw !== 'string') {
			return res.status(400).json({ error: '金額は数値である必要があります' });
		}
		
		const amount = parseInt(amountRaw, 10);
		if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
			return res.status(400).json({ error: '有効な金額（1以上の整数）を指定してください' });
		}
		
		if (amount > Number.MAX_SAFE_INTEGER) {
			return res.status(400).json({ 
				error: `金額が大きすぎます（最大値: ${Number.MAX_SAFE_INTEGER.toLocaleString()}）` 
			});
		}

		// 現在の残高を確認（所持金 + 預金）
		const currentBalance = await romecoin.getRomecoin(userId);
		const bank = require('./features/bank');
		const bankData = bank.loadBankData();
		const { getData: getBankData } = require('./features/dataAccess');
		const INTEREST_RATE_PER_HOUR = 0.00000228;
		const INTEREST_INTERVAL_MS = 60 * 60 * 1000;
		const now = Date.now();
		
		const userBankData = await getBankData(userId, bankData, {
			deposit: 0,
			lastInterestTime: Date.now(),
		});
		const hoursPassed = (now - userBankData.lastInterestTime) / INTEREST_INTERVAL_MS;
		let deposit = userBankData.deposit || 0;
		if (hoursPassed > 0 && deposit > 0) {
			const interest = Math.round(deposit * (Math.pow(1 + INTEREST_RATE_PER_HOUR, hoursPassed) - 1));
			if (interest > 0) {
				deposit += interest;
			}
		}
		
		const totalBalance = currentBalance + deposit;
		if (totalBalance < amount) {
			return res.status(400).json({
				error: 'ロメコインが不足しています（所持金 + 預金）',
				currentBalance,
				deposit,
				totalBalance,
				required: amount,
				shortfall: amount - totalBalance,
			});
		}

		// ロメコインを減らす（ログ付き、預金から自動引き出し）
		await romecoin.updateRomecoin(userId, (current) => Math.round((current || 0) - amount), {
			log: true,
			client: client,
			reason: `API経由での減額`,
			metadata: {
				commandName: 'api_deduct',
			},
			useDeposit: true,
		});
		const newBalance = await romecoin.getRomecoin(userId);

		// Botアカウントにロメコインを追加（部活作成費用など）
		const botUserId = client.user?.id;
		if (botUserId) {
			try {
				await romecoin.updateRomecoin(botUserId, (current) => Math.round((current || 0) + amount), {
					log: true,
					client: client,
					reason: `API経由での減額に伴うBotアカウントへの追加`,
					metadata: {
						targetUserId: userId,
						commandName: 'api_deduct',
					},
				});
				console.log(`[API] Botアカウントに${amount}ロメコインを追加しました`);
			} catch (botError) {
				console.error('[API] Botアカウントへのロメコイン追加エラー:', botError);
				// Botへの追加が失敗しても、ユーザーからの減額は成功しているので処理は続行
			}
		} else {
			console.warn('[API] client.user.idが利用できません。Botアカウントへのロメコイン追加をスキップします。');
		}

		res.json({
			success: true,
			userId,
			deducted: amount,
			previousBalance: currentBalance,
			newBalance,
			transferredToBot: botUserId ? amount : 0,
		});
	} catch (error) {
		console.error('[API] ロメコイン減額エラー:', error);
		console.error('[API] エラースタック:', error.stack);
		res.status(500).json({
			error: 'ロメコインの減額に失敗しました',
			message: error.message,
			details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
		});
	}
});

// ロメコインを追加
app.post('/api/romecoin/:userId/add', authenticateAPI, async (req, res) => {
	try {
		const userId = req.params.userId;
		const amountRaw = req.body.amount;
		
		// 数値の検証を強化
		if (typeof amountRaw !== 'number' && typeof amountRaw !== 'string') {
			return res.status(400).json({ error: '金額は数値である必要があります' });
		}
		
		const amount = parseInt(amountRaw, 10);
		if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
			return res.status(400).json({ error: '有効な金額（1以上の整数）を指定してください' });
		}
		
		if (amount > Number.MAX_SAFE_INTEGER) {
			return res.status(400).json({ 
				error: `金額が大きすぎます（最大値: ${Number.MAX_SAFE_INTEGER.toLocaleString()}）` 
			});
		}

		// 現在の残高を取得
		const previousBalance = await romecoin.getRomecoin(userId);

		// ロメコインを追加（ログ付き）
		await romecoin.updateRomecoin(userId, (current) => Math.round((current || 0) + amount), {
			log: true,
			client: client,
			reason: `API経由での増額`,
			metadata: {
				commandName: 'api_add',
			},
		});
		const newBalance = await romecoin.getRomecoin(userId);

		console.log(
			`[API] ロメコイン追加: userId=${userId}, amount=${amount}, previousBalance=${previousBalance}, newBalance=${newBalance}`
		);

		res.json({
			success: true,
			userId,
			added: amount,
			previousBalance,
			balance: newBalance,
		});
	} catch (error) {
		console.error('[API] ロメコイン追加エラー:', error);
		console.error('[API] エラースタック:', error.stack);
		res.status(500).json({
			error: 'ロメコインの追加に失敗しました',
			message: error.message,
			details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
		});
	}
});

// データ引き継ぎ（Notion連携時）
app.post('/api/migrate/:userId', authenticateAPI, async (req, res) => {
	try {
		const userId = req.params.userId;
		console.log(`[API] データ引き継ぎリクエスト: userId=${userId}`);

		if (!userId || userId.trim() === '') {
			return res.status(400).json({ error: 'ユーザーIDが指定されていません' });
		}

		const { migrateData, getDataWithPrefix, setDataWithPrefix } = require('./features/dataAccess');
		const fs = require('fs');
		const path = require('path');
		
		// 各データファイルを引き継ぎ
		const dataFiles = {
			romecoin: path.join(__dirname, 'romecoin_data.json'),
			bank: path.join(__dirname, 'bank_data.json'),
			daily: path.join(__dirname, 'daily_data.json'),
			loan: path.join(__dirname, 'loan_data.json'),
			duel: path.join(__dirname, 'duel_data.json'),
			janken: path.join(__dirname, 'janken_data.json'),
			shop: path.join(__dirname, 'data', 'shop_data.json'),
			mahjong: path.join(__dirname, 'mahjong_data.json'),
			activity: path.join(__dirname, 'activity_data.json'),
			custom_cooldowns: path.join(__dirname, 'custom_cooldowns.json'),
		};

		const results = {};
		
		// ロメコインデータの引き継ぎ
		if (fs.existsSync(dataFiles.romecoin)) {
			const romecoinData = JSON.parse(fs.readFileSync(dataFiles.romecoin, 'utf8'));
			const migrated = await migrateData(userId, romecoinData);
			if (migrated) {
				fs.writeFileSync(dataFiles.romecoin, JSON.stringify(romecoinData, null, 2));
				results.romecoin = 'migrated';
			} else {
				results.romecoin = 'no_migration_needed';
			}
		}

		// 銀行データの引き継ぎ
		if (fs.existsSync(dataFiles.bank)) {
			const bankData = JSON.parse(fs.readFileSync(dataFiles.bank, 'utf8'));
			const migrated = await migrateData(userId, bankData);
			if (migrated) {
				fs.writeFileSync(dataFiles.bank, JSON.stringify(bankData, null, 2));
				results.bank = 'migrated';
			} else {
				results.bank = 'no_migration_needed';
			}
		}

		// ログインデータの引き継ぎ
		if (fs.existsSync(dataFiles.daily)) {
			const dailyData = JSON.parse(fs.readFileSync(dataFiles.daily, 'utf8'));
			const migrated = await migrateData(userId, dailyData);
			if (migrated) {
				fs.writeFileSync(dataFiles.daily, JSON.stringify(dailyData, null, 2));
				results.daily = 'migrated';
			} else {
				results.daily = 'no_migration_needed';
			}
		}

		// 借金データの引き継ぎ（特殊処理）
		if (fs.existsSync(dataFiles.loan)) {
			const loanData = JSON.parse(fs.readFileSync(dataFiles.loan, 'utf8'));
			const bank = require('./features/bank');
			await bank.migrateLoanData(userId, loanData);
			fs.writeFileSync(dataFiles.loan, JSON.stringify(loanData, null, 2));
			results.loan = 'migrated';
		}

		// デュエルデータの引き継ぎ
		if (fs.existsSync(dataFiles.duel)) {
			const duelData = JSON.parse(fs.readFileSync(dataFiles.duel, 'utf8'));
			const migrated = await migrateData(userId, duelData);
			if (migrated) {
				fs.writeFileSync(dataFiles.duel, JSON.stringify(duelData, null, 2));
				results.duel = 'migrated';
			} else {
				results.duel = 'no_migration_needed';
			}
		}

		// じゃんけんデータの引き継ぎ
		if (fs.existsSync(dataFiles.janken)) {
			const jankenData = JSON.parse(fs.readFileSync(dataFiles.janken, 'utf8'));
			const migrated = await migrateData(userId, jankenData);
			if (migrated) {
				fs.writeFileSync(dataFiles.janken, JSON.stringify(jankenData, null, 2));
				results.janken = 'migrated';
			} else {
				results.janken = 'no_migration_needed';
			}
		}

		// ショップデータの引き継ぎ
		if (fs.existsSync(dataFiles.shop)) {
			const shopData = JSON.parse(fs.readFileSync(dataFiles.shop, 'utf8'));
			const migrated = await migrateData(userId, shopData);
			if (migrated) {
				fs.writeFileSync(dataFiles.shop, JSON.stringify(shopData, null, 2));
				results.shop = 'migrated';
			} else {
				results.shop = 'no_migration_needed';
			}
		}

		// 麻雀データの引き継ぎ
		if (fs.existsSync(dataFiles.mahjong)) {
			const mahjongData = JSON.parse(fs.readFileSync(dataFiles.mahjong, 'utf8'));
			const migrated = await migrateData(userId, mahjongData);
			if (migrated) {
				fs.writeFileSync(dataFiles.mahjong, JSON.stringify(mahjongData, null, 2));
				results.mahjong = 'migrated';
			} else {
				results.mahjong = 'no_migration_needed';
			}
		}

		// アクティビティデータの引き継ぎ
		if (fs.existsSync(dataFiles.activity)) {
			const activityData = JSON.parse(fs.readFileSync(dataFiles.activity, 'utf8'));
			const migrated = await migrateData(userId, activityData);
			if (migrated) {
				fs.writeFileSync(dataFiles.activity, JSON.stringify(activityData, null, 2));
				results.activity = 'migrated';
			} else {
				results.activity = 'no_migration_needed';
			}
		}

		// クールダウンデータの引き継ぎ（プレフィックス付き）
		if (fs.existsSync(dataFiles.custom_cooldowns)) {
			const cooldownData = JSON.parse(fs.readFileSync(dataFiles.custom_cooldowns, 'utf8'));
			// クールダウンデータは 'battle_' プレフィックスを使用
			const migrated = await migrateData(userId, cooldownData, 'battle_');
			if (migrated) {
				fs.writeFileSync(dataFiles.custom_cooldowns, JSON.stringify(cooldownData, null, 2));
				results.custom_cooldowns = 'migrated';
			} else {
				results.custom_cooldowns = 'no_migration_needed';
			}
		}

		console.log(`[API] データ引き継ぎ完了: userId=${userId}`, results);
		res.json({
			success: true,
			userId,
			results,
		});
	} catch (error) {
		console.error('[API] データ引き継ぎエラー:', error);
		console.error('[API] エラースタック:', error.stack);
		res.status(500).json({
			error: 'データの引き継ぎに失敗しました',
			message: error.message,
			details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
		});
	}
});

// 404ハンドラー（デバッグ用）
app.use((req, res) => {
	console.log(`[404] リクエストが見つかりません: ${req.method} ${req.path}`);
	console.log(`[404] クエリ:`, req.query);
	console.log(`[404] ヘッダー:`, req.headers);
	res.status(404).json({
		error: 'エンドポイントが見つかりません',
		method: req.method,
		path: req.path,
		availableEndpoints: [
			'GET /',
			'GET /api/romecoin/:userId',
			'POST /api/romecoin/:userId/deduct',
			'POST /api/romecoin/:userId/add',
			'POST /api/migrate/:userId',
		],
	});
});

client.once('clientReady', async (client) => {
	console.log(`Logged in as ${client.user.tag}!`);
	console.log(`CROSSROID, ready for duty.`);

	const guild = client.guilds.cache.first();
	if (guild) {
		const botMember = guild.members.me;
		console.log(`ボットの権限:`, botMember.permissions.toArray());
		console.log(`レベル10ロールID: ${LEVEL_10_ROLE_ID}`);
		console.log(`現在の世代ロールID: ${CURRENT_GENERATION_ROLE_ID}`);
		console.log(`メインチャンネルID: ${MAIN_CHANNEL_ID}`);
	}

	// スラッシュコマンドを登録
	const commands = [
		new SlashCommandBuilder()
			.setName('anonymous')
			.setDescription('匿名でメッセージを送信します')
			.addStringOption((option) =>
				option.setName('内容').setDescription('送信するメッセージ（256文字以下、改行禁止）').setRequired(true)
			),
		new SlashCommandBuilder().setName('bump').setDescription('部活チャンネルを宣伝します（2時間に1回まで）'),
		new SlashCommandBuilder()
			.setName('test_generation')
			.setDescription('世代獲得通知のテスト（運営専用）')
			.addUserOption((option) =>
				option.setName('ユーザー').setDescription('テスト対象のユーザー').setRequired(true)
			),
		new SlashCommandBuilder()
			.setName('test_timereport')
			.setDescription('時報機能のテスト（運営専用）')
			.addIntegerOption((option) =>
				option.setName('時間').setDescription('テストする時間（0-23）').setRequired(true)
			),
		new SlashCommandBuilder()
			.setName('random_mention')
			.setDescription('サーバーメンバーをランダムでメンションします'),
		new SlashCommandBuilder()
			.setName('duel')
			.setDescription('他のユーザーと決闘します')
			.addUserOption((option) =>
				option
					.setName('対戦相手')
					.setDescription('対戦相手（指定しない場合は誰でも挑戦可能）')
					.setRequired(false)
			)
			.addIntegerOption((option) =>
				option
					.setName('bet')
					.setDescription('賭けるロメコインの量（指定されていない場合は100）')
					.setRequired(false)
			),
		new SlashCommandBuilder()
			.setName('duel_russian')
			.setDescription('ロシアンルーレットで対戦します')
			.addUserOption((option) =>
				option
					.setName('対戦相手')
					.setDescription('対戦相手（指定しない場合は誰でも挑戦可能）')
					.setRequired(false)
			)
			.addIntegerOption((option) =>
				option
					.setName('bet')
					.setDescription('賭けるロメコインの量（指定されていない場合は100）')
					.setRequired(false)
			),
		new SlashCommandBuilder().setName('duel_ranking').setDescription('決闘のランキングを表示します'),
		new SlashCommandBuilder().setName('janken_ranking').setDescription('じゃんけんのランキングを表示します'),
		new SlashCommandBuilder()
			.setName('romecoin')
			.setDescription('ロメコインの所持数を確認します')
			.addUserOption((option) => option.setName('user').setDescription('確認したいユーザー')),
		new SlashCommandBuilder().setName('romecoin_ranking').setDescription('ロメコインランキングを確認します'),
		new SlashCommandBuilder()
			.setName('give')
			.setDescription('ロメコインを他のユーザーに譲渡します（世代ロール必須）')
			.addUserOption((option) =>
				option.setName('user').setDescription('ロメコインを受け取るユーザー').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('amount').setDescription('譲渡するロメコインの量').setRequired(true)
			),
		new SlashCommandBuilder()
			.setName('janken')
			.setDescription('じゃんけんを開始します')
			.addUserOption((option) =>
				option
					.setName('opponent')
					.setDescription('対戦相手を選択(クロスロイドを指定するとボット対戦 空白だと対戦募集します)')
			)
			.addIntegerOption((option) =>
				option
					.setName('bet')
					.setDescription('賭けるロメコインの量(100以上の整数で指定 指定されていない場合は100)')
			),
		new SlashCommandBuilder()
			.setName('mahjong_create')
			.setDescription('雀魂を使った賭け麻雀のテーブルを作成します')
			.addNumberOption((option) =>
				option
					.setName('rate')
					.setDescription('レート（1点あたりのロメコイン、0.1〜1）')
					.setRequired(true)
					.setMinValue(0.1)
					.setMaxValue(1)
			)
			.addUserOption((option) =>
				option
					.setName('player1')
					.setDescription('参加メンバー1（サンマの場合は2人、四麻の場合は3人必要）')
					.setRequired(true)
			)
			.addUserOption((option) => option.setName('player2').setDescription('参加メンバー2').setRequired(true))
			.addUserOption((option) =>
				option.setName('player3').setDescription('参加メンバー3（四麻の場合のみ必要）').setRequired(false)
			),
		new SlashCommandBuilder()
			.setName('mahjong_result')
			.setDescription('賭け麻雀の試合結果を入力します')
			.addStringOption((option) =>
				option.setName('table_id').setDescription('テーブルID（試合開始時に表示されます）').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('player1_score').setDescription('部屋主の点数').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('player2_score').setDescription('プレイヤー1の点数').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('player3_score').setDescription('プレイヤー2の点数').setRequired(true)
			)
			.addIntegerOption((option) =>
				option
					.setName('player4_score')
					.setDescription('プレイヤー3の点数（四麻の場合のみ必要）')
					.setRequired(false)
			),
		new SlashCommandBuilder()
			.setName('mahjong_edit')
			.setDescription('賭け麻雀の試合記録を修正します（部屋主のみ）')
			.addStringOption((option) =>
				option.setName('table_id').setDescription('修正するテーブルID').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('player1_score').setDescription('部屋主の点数（修正後）').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('player2_score').setDescription('プレイヤー1の点数（修正後）').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('player3_score').setDescription('プレイヤー2の点数（修正後）').setRequired(true)
			)
			.addIntegerOption((option) =>
				option
					.setName('player4_score')
					.setDescription('プレイヤー3の点数（修正後、四麻の場合のみ必要）')
					.setRequired(false)
			),
		new SlashCommandBuilder().setName('mahjong_ranking').setDescription('賭け麻雀のランキングを表示します'),
		new SlashCommandBuilder()
			.setName('database_export')
			.setDescription('データベースをエクスポートします(運営専用)'),
		new SlashCommandBuilder()
			.setName('data_migrate')
			.setDescription('Discord IDベースのデータをNotion名ベースに引き継ぎます(運営専用)')
			.addUserOption((option) =>
				option.setName('user').setDescription('引き継ぎ対象のユーザー').setRequired(true)
			),
		new SlashCommandBuilder()
			.setName('monthly_ranking_rewards')
			.setDescription('月間ランキングの上位10人に賞金を一括付与します（運営専用）')
			.addUserOption((option) => option.setName('rank1').setDescription('1位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank2').setDescription('2位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank3').setDescription('3位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank4').setDescription('4位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank5').setDescription('5位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank6').setDescription('6位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank7').setDescription('7位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank8').setDescription('8位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank9').setDescription('9位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank10').setDescription('10位のユーザー').setRequired(false)),
		new SlashCommandBuilder()
			.setName('popularity_championship_rewards')
			.setDescription('人気者選手権の上位10人に賞金を一括付与します（運営専用）')
			.addUserOption((option) => option.setName('rank1').setDescription('1位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank2').setDescription('2位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank3').setDescription('3位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank4').setDescription('4位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank5').setDescription('5位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank6').setDescription('6位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank7').setDescription('7位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank8').setDescription('8位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank9').setDescription('9位のユーザー').setRequired(false))
			.addUserOption((option) => option.setName('rank10').setDescription('10位のユーザー').setRequired(false)),
		new SlashCommandBuilder()
			.setName('admin_romecoin_add')
			.setDescription('指定ユーザーのロメコインを増額します（管理者専用）')
			.addUserOption((option) =>
				option.setName('user').setDescription('ロメコインを増額するユーザー').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('amount').setDescription('増額するロメコインの量').setRequired(true)
			),
		new SlashCommandBuilder()
			.setName('admin_romecoin_deduct')
			.setDescription('指定ユーザーのロメコインを減額します（管理者専用）')
			.addUserOption((option) =>
				option.setName('user').setDescription('ロメコインを減額するユーザー').setRequired(true)
			)
			.addIntegerOption((option) =>
				option.setName('amount').setDescription('減額するロメコインの量').setRequired(true)
			),
		new SlashCommandBuilder().setName('shop').setDescription('ロメコインショップを表示します'),
		new SlashCommandBuilder().setName('backpack').setDescription('購入済みの商品を確認します'),
		new SlashCommandBuilder()
			.setName('club_invest')
			.setDescription('部活投資機能')
			.addSubcommand((subcommand) =>
				subcommand
					.setName('info')
					.setDescription('部活の投資情報を表示します')
					.addChannelOption((option) =>
						option.setName('channel').setDescription('部活チャンネル（未指定時は現在のチャンネル）').setRequired(false)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('buy')
					.setDescription('部活に投資（株式購入）します')
					.addIntegerOption((option) =>
						option.setName('amount').setDescription('投資額（ロメコイン）').setRequired(true)
					)
					.addChannelOption((option) =>
						option.setName('channel').setDescription('部活チャンネル（未指定時は現在のチャンネル）').setRequired(false)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('sell')
					.setDescription('保有株式を売却します')
					.addIntegerOption((option) =>
						option.setName('shares').setDescription('売却する株式数').setRequired(true)
					)
					.addChannelOption((option) =>
						option.setName('channel').setDescription('部活チャンネル（未指定時は現在のチャンネル）').setRequired(false)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand.setName('portfolio').setDescription('自分の投資ポートフォリオを表示します')
			),
		new SlashCommandBuilder().setName('daily').setDescription('デイリーログインボーナスを受け取ります'),
		new SlashCommandBuilder()
			.setName('race')
			.setDescription('パリミュチュエル方式のレース賭け機能')
			.addSubcommand((subcommand) =>
				subcommand
					.setName('create')
					.setDescription('レースを作成します（管理者専用）')
					.addStringOption((option) =>
						option.setName('race_id').setDescription('レースID（一意の識別子）').setRequired(true)
					)
					.addStringOption((option) =>
						option.setName('name').setDescription('レース名').setRequired(true)
					)
					.addStringOption((option) =>
						option
							.setName('candidates')
							.setDescription('候補者名（カンマ区切り、例: 候補者1,候補者2,候補者3）')
							.setRequired(true)
					)
			)
			.addSubcommand((subcommand) => subcommand.setName('list').setDescription('開催中のレース一覧を表示します'))
			.addSubcommand((subcommand) =>
				subcommand
					.setName('info')
					.setDescription('レース情報とオッズを表示します')
					.addStringOption((option) =>
						option.setName('race_id').setDescription('レースID').setRequired(true)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('bet')
					.setDescription('レースに賭けます')
					.addStringOption((option) =>
						option.setName('race_id').setDescription('レースID').setRequired(true)
					)
					.addStringOption((option) =>
						option
							.setName('bet_type')
							.setDescription('賭けの種類')
							.setRequired(true)
							.addChoices(
								{ name: '単勝', value: 'tansho' },
								{ name: '複勝', value: 'fukusho' },
								{ name: 'ワイド', value: 'wide' },
								{ name: '三連複', value: 'sanrenpuku' },
								{ name: '三連単', value: 'sanrentan' }
							)
					)
					.addIntegerOption((option) =>
						option.setName('amount').setDescription('賭け金（最低100ロメコイン）').setRequired(true).setMinValue(100)
					)
					.addStringOption((option) =>
						option.setName('selection1').setDescription('選択1（単勝・複勝: 1名、ワイド: 1名目、三連複・三連単: 1着）').setRequired(true)
					)
					.addStringOption((option) =>
						option
							.setName('selection2')
							.setDescription('選択2（ワイド: 3着以内の2名目、三連複・三連単: 2着）')
							.setRequired(false)
					)
					.addStringOption((option) =>
						option.setName('selection3').setDescription('選択3（三連複・三連単: 3着）').setRequired(false)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('close')
					.setDescription('レースの受付を締め切ります（管理者専用）')
					.addStringOption((option) =>
						option.setName('race_id').setDescription('レースID').setRequired(true)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('result')
					.setDescription('レースの結果を確定します（管理者専用）')
					.addStringOption((option) =>
						option.setName('race_id').setDescription('レースID').setRequired(true)
					)
					.addStringOption((option) =>
						option
							.setName('result')
							.setDescription('結果（カンマ区切り、順番通り、例: 1着,2着,3着）')
							.setRequired(true)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('mybets')
					.setDescription('自分の賭け一覧を表示します')
					.addStringOption((option) =>
						option.setName('race_id').setDescription('レースID（未指定時は全レース）').setRequired(false)
					)
			),
		new SlashCommandBuilder()
			.setName('bank')
			.setDescription('黒須銀行機能')
			.addSubcommand((subcommand) =>
				subcommand
					.setName('deposit')
					.setDescription('預金します')
					.addIntegerOption((option) =>
						option.setName('amount').setDescription('預金額').setRequired(true)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('withdraw')
					.setDescription('引き出します')
					.addIntegerOption((option) =>
						option.setName('amount').setDescription('引き出し額').setRequired(true)
					)
			)
			.addSubcommand((subcommand) => subcommand.setName('info').setDescription('預金情報を確認します')),
		new SlashCommandBuilder()
			.setName('loan')
			.setDescription('借金機能')
			.addSubcommand((subcommand) =>
				subcommand
					.setName('request')
					.setDescription('借金を貸します')
					.addUserOption((option) =>
						option.setName('borrower').setDescription('借り手').setRequired(true)
					)
					.addIntegerOption((option) =>
						option.setName('amount').setDescription('貸付額').setRequired(true)
					)
					.addIntegerOption((option) =>
						option.setName('days').setDescription('返済期限（日数、デフォルト: 7日）').setRequired(false)
					)
			)
			.addSubcommand((subcommand) =>
				subcommand
					.setName('repay')
					.setDescription('借金を返済します')
					.addUserOption((option) =>
						option.setName('lender').setDescription('貸し手').setRequired(true)
					)
			)
			.addSubcommand((subcommand) => subcommand.setName('info').setDescription('借金情報を確認します')),
		new ContextMenuCommandBuilder().setName('匿名開示 (運営専用)').setType(ApplicationCommandType.Message),
	].map((command) => command.toJSON());

	try {
		// 既存のコマンドを取得
		const existingCommands = await client.application.commands.fetch();
		console.log(`[コマンド登録] 既存のコマンド数: ${existingCommands.size}`);
		
		// 登録するコマンドのリストをログ出力
		console.log(`[コマンド登録] 登録するコマンド数: ${commands.length}`);
		commands.forEach((cmd, index) => {
			console.log(`[コマンド登録] ${index + 1}. ${cmd.name} - ${cmd.description || 'サブコマンドあり'}`);
		});
		
		// コマンドを登録（既存のコマンドは自動的に上書きされる）
		const registeredCommands = await client.application.commands.set(commands);
		console.log(`[コマンド登録] 登録完了！登録されたコマンド数: ${registeredCommands.size}`);
		
		// 登録されたコマンドのリストをログ出力
		registeredCommands.forEach((cmd) => {
			console.log(`[コマンド登録] ✓ ${cmd.name} (ID: ${cmd.id})`);
		});
		
		// 削除されたコマンドを確認（既存にあって新しいリストにないもの）
		const newCommandNames = new Set(commands.map(cmd => cmd.name));
		const deletedCommands = existingCommands.filter(cmd => !newCommandNames.has(cmd.name));
		if (deletedCommands.size > 0) {
			console.log(`[コマンド登録] 削除されたコマンド数: ${deletedCommands.size}`);
			deletedCommands.forEach(cmd => {
				console.log(`[コマンド登録] ✗ 削除: ${cmd.name} (ID: ${cmd.id})`);
			});
		}
	} catch (e) {
		console.error('[コマンド登録] スラッシュコマンドの登録に失敗しました:', e);
		console.error('[コマンド登録] エラースタック:', e.stack);
	}

	// 期限切れの借金を定期的にチェック（1時間ごと）
	setInterval(async () => {
		try {
			await bank.checkOverdueLoans(client);
		} catch (error) {
			console.error('[Loan] 期限切れチェックエラー:', error);
		}
	}, 60 * 60 * 1000); // 1時間ごと

	// 再起動通知を送信
	try {
		const notifyChannelId = '1431905157657923646';
		const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
		if (channel) {
			const commitSha = process.env.KOYEB_GIT_SHA || 'Unknown';
			const commitMessage = process.env.KOYEB_GIT_COMMIT_MESSAGE || 'Unknown';

			const commitMessageShort =
				commitMessage.length > 1000 ? commitMessage.slice(0, 997) + '...' : commitMessage;

			const embed = new EmbedBuilder()
				.setTitle('🥸再起動しました。確認してください。')
				.setColor(0x5865f2)
				.setDescription(commitMessageShort || 'コミットメッセージはありません。')
				.addFields({ name: 'Commit', value: '`' + commitSha + '`', inline: true })
				.setTimestamp(new Date())
				.setFooter({ text: client.user.tag, iconURL: client.user.displayAvatarURL() });

			await channel.send({ embeds: [embed] });
		}
	} catch (e) {
		console.error('再起動通知の送信に失敗しました:', e);
	}

	// 各機能のセットアップ
	timeSignal.setup(client);
	vcNotify.setup(client);
	highlight.setup(client);
	imageLog.setup(client);
	roleAward.setup(client);
	legacyMigration.setup(client);
	// データ復元を先に実行（保存処理の前に）
	await persistence.restore(client);
	// データ復元後に同期を開始
	persistence.startSync(client);
	activityTracker.start(client);
	await proxy.clientReady(client);
	await romecoin.clientReady(client);
	
	// クロスロイドの所持金を黒須銀行の預金として移行
	await bank.migrateBotBalanceToBank(client);
});

// コマンド処理
client.on('interactionCreate', async (interaction) => {
	try {
		await handleCommands(interaction, client);
		await romecoin.interactionCreate(interaction);
		
		// デイリーログインボーナス
		if (interaction.isChatInputCommand() && interaction.commandName === 'daily') {
			await daily.handleDaily(interaction, client);
		}
		
		// 銀行機能
		if (interaction.isChatInputCommand() && interaction.commandName === 'bank') {
			const subcommand = interaction.options.getSubcommand();
			if (subcommand === 'deposit') {
				await bank.handleBankDeposit(interaction, client);
			} else if (subcommand === 'withdraw') {
				await bank.handleBankWithdraw(interaction, client);
			} else if (subcommand === 'info') {
				await bank.handleBankInfo(interaction, client);
			}
		}
		
		// 借金機能
		if (interaction.isChatInputCommand() && interaction.commandName === 'loan') {
			const subcommand = interaction.options.getSubcommand();
			if (subcommand === 'request') {
				await bank.handleLoanRequest(interaction, client);
			} else if (subcommand === 'repay') {
				await bank.handleLoanRepay(interaction, client);
			} else if (subcommand === 'info') {
				await bank.handleLoanInfo(interaction, client);
			}
		}

		// 麻雀ボタンインタラクション
		if (interaction.isButton() && interaction.customId.startsWith('mahjong_agree_')) {
			await mahjong.handleAgreement(interaction, client);
		}
		if (interaction.isButton() && interaction.customId.startsWith('mahjong_cancel_')) {
			await mahjong.handleCancel(interaction, client);
		}

		// 借金ボタンインタラクション
		if (interaction.isButton() && interaction.customId.startsWith('loan_agree_')) {
			await bank.handleLoanAgreement(interaction, client);
		}
		if (interaction.isButton() && interaction.customId.startsWith('loan_cancel_')) {
			await bank.handleLoanCancel(interaction, client);
		}
	} catch (error) {
		// Unknown interactionエラー（コード10062, 40060）は無視
		if (error.code === 10062 || error.code === 40060) {
			return;
		}
		console.error('[Interaction] エラー:', error);
		
		// エラーが発生した場合、まだ応答していなければエラーメッセージを送信
		if (!interaction.replied && !interaction.deferred) {
			try {
				if (interaction.isChatInputCommand() || interaction.isButton()) {
					await interaction.reply({
						content: 'エラーが発生しました。',
						flags: interaction.isChatInputCommand() ? [require('discord.js').MessageFlags.Ephemeral] : [],
					}).catch(() => {});
				}
			} catch (replyError) {
				// 応答エラーも無視（インタラクションが既に期限切れの可能性）
				if (replyError.code !== 10062 && replyError.code !== 40060) {
					console.error('[Interaction] 応答エラー:', replyError);
				}
			}
		}
	}
});

client.on('messageCreate', async (message) => {
	abuseProtocol.handleMessage(message);
	await proxy.messageCreate(message);
	await romecoin.messageCreate(message);
});

client.on('messageReactionAdd', async (reaction, user) => {
	await romecoin.messageReactionAdd(reaction, user);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
	await romecoin.handleVoiceStateUpdate(oldState, newState);
});

process.on('uncaughtException', async (error, origin) => {
	console.error('Uncaught Exception:', error);
	try {
		const errorlog_channel = await client.channels.fetch(ERRORLOG_CHANNEL_ID).catch(() => null);
		if (errorlog_channel) {
			await errorlog_channel.send({ content: `Uncaught Exception\n\`\`\`${error.stack}\`\`\`` }).catch(() => {
				// エラーログ送信に失敗しても無視（無限ループを防ぐ）
			});
		}
	} catch (e) {
		// エラーハンドリング内でエラーが発生しても無視（無限ループを防ぐ）
		console.error('エラーログ送信に失敗:', e);
	}
	// プロセスを終了させない
});

process.on('unhandledRejection', async (reason, promise) => {
	console.error('Unhandled Rejection:', reason);
	try {
		const errorlog_channel = await client.channels.fetch(ERRORLOG_CHANNEL_ID).catch(() => null);
		const message = reason instanceof Error ? reason.stack : String(reason);
		if (errorlog_channel) {
			await errorlog_channel.send({ content: `Unhandled Rejection\n\`\`\`${message}\`\`\`` }).catch(() => {
				// エラーログ送信に失敗しても無視（無限ループを防ぐ）
			});
		}
	} catch (e) {
		// エラーハンドリング内でエラーが発生しても無視（無限ループを防ぐ）
		console.error('エラーログ送信に失敗:', e);
	}
	// プロセスを終了させない
});

// ログイン
if (!process.env.DISCORD_TOKEN) {
	console.error('❌ DISCORD_TOKENがありません。終了します。');
	process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
	console.error('❌ ログイン失敗:', error);
	process.exit(1);
});

// Webサーバー起動
app.listen(PORT, '0.0.0.0', () => {
	console.log(`Server is running on port ${PORT}. Ready for Uptime Robot.`);
});
