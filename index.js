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

// Command Handler
const { handleCommands } = require('./commands');
const romecoin = require('./features/romecoin');

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
		const amount = parseInt(req.body.amount);

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: '有効な金額を指定してください' });
		}

		// 現在の残高を確認
		const currentBalance = await romecoin.getRomecoin(userId);
		if (currentBalance < amount) {
			return res.status(400).json({
				error: 'ロメコインが不足しています',
				currentBalance,
				required: amount,
				shortfall: amount - currentBalance,
			});
		}

		// ロメコインを減らす
		await romecoin.updateRomecoin(userId, (current) => Math.round((current || 0) - amount));
		const newBalance = await romecoin.getRomecoin(userId);

		// Botアカウントにロメコインを追加（部活作成費用など）
		const botUserId = client.user?.id;
		if (botUserId) {
			try {
				await romecoin.updateRomecoin(botUserId, (current) => Math.round((current || 0) + amount));
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

// 404ハンドラー（デバッグ用）
app.use((req, res) => {
	console.log(`[404] リクエストが見つかりません: ${req.method} ${req.path}`);
	console.log(`[404] クエリ:`, req.query);
	console.log(`[404] ヘッダー:`, req.headers);
	res.status(404).json({
		error: 'エンドポイントが見つかりません',
		method: req.method,
		path: req.path,
		availableEndpoints: ['GET /', 'GET /api/romecoin/:userId', 'POST /api/romecoin/:userId/deduct'],
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
			.setName('event_create')
			.setDescription('イベント用チャンネルを作成し、告知を行います')
			.addStringOption((option) =>
				option
					.setName('イベント名')
					.setDescription('イベントのタイトル（チャンネル名になります）')
					.setRequired(true)
			)
			.addStringOption((option) => option.setName('内容').setDescription('イベントの詳細内容').setRequired(true))
			.addStringOption((option) => option.setName('日時').setDescription('開催日時（任意）'))
			.addStringOption((option) => option.setName('場所').setDescription('開催場所')),
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
			.setName('database_export')
			.setDescription('データベースをエクスポートします(運営専用)'),
		new SlashCommandBuilder()
			.setName('data_migrate')
			.setDescription('Discord IDベースのデータをNotion名ベースに引き継ぎます(運営専用)')
			.addUserOption((option) =>
				option.setName('user').setDescription('引き継ぎ対象のユーザー').setRequired(true)
			),
		new ContextMenuCommandBuilder().setName('匿名開示 (運営専用)').setType(ApplicationCommandType.Message),
	].map((command) => command.toJSON());

	try {
		await client.application.commands.set(commands);
		console.log('スラッシュコマンドの登録が完了しました！');
	} catch (e) {
		console.error('スラッシュコマンドの登録に失敗しました:', e);
	}

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
	proxy.setup(client);
	highlight.setup(client);
	imageLog.setup(client);
	roleAward.setup(client);
	legacyMigration.setup(client);
	// データ復元を先に実行（保存処理の前に）
	await persistence.restore(client);
	// データ復元後に同期を開始
	persistence.startSync(client);
	activityTracker.start(client);
	await romecoin.clientReady(client);
});

// コマンド処理
client.on('interactionCreate', async (interaction) => {
	await handleCommands(interaction, client);
	await romecoin.interactionCreate(interaction);
});

client.on('messageCreate', async (message) => {
	abuseProtocol.handleMessage(message);
	await romecoin.messageCreate(message);
});

client.on('messageReactionAdd', async (reaction, user) => {
	await romecoin.messageReactionAdd(reaction, user);
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
