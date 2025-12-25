const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { updateRomecoin, getRomecoin } = require('./romecoin');
const { getData, updateData, migrateData, getDataKey } = require('./dataAccess');
const { CURRENT_GENERATION_ROLE_ID } = require('../constants');

const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';
const BANK_DATA_FILE = path.join(__dirname, '..', 'bank_data.json');
const LOAN_DATA_FILE = path.join(__dirname, '..', 'loan_data.json');

// 銀行の利子率（1時間ごとに約0.000228%、年利2%相当）
const INTEREST_RATE_PER_HOUR = 0.00000228;
// 借金の利子率（1時間ごとに1.5%）
const LOAN_INTEREST_RATE_PER_HOUR = 0.015;
// 利子計算の間隔（1時間 = 3600000ms）
const INTEREST_INTERVAL_MS = 60 * 60 * 1000;

// データ読み込み
function loadBankData() {
	if (fs.existsSync(BANK_DATA_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(BANK_DATA_FILE, 'utf8'));
		} catch (e) {
			console.error('[Bank] データ読み込みエラー:', e);
			return {};
		}
	}
	return {};
}

function loadLoanData() {
	if (fs.existsSync(LOAN_DATA_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(LOAN_DATA_FILE, 'utf8'));
		} catch (e) {
			console.error('[Loan] データ読み込みエラー:', e);
			return {};
		}
	}
	return {};
}

// データ保存
function saveBankData(data) {
	try {
		fs.writeFileSync(BANK_DATA_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error('[Bank] データ保存エラー:', e);
	}
}

function saveLoanData(data) {
	try {
		fs.writeFileSync(LOAN_DATA_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error('[Loan] データ保存エラー:', e);
	}
}

// 利子計算
function calculateInterest(principal, hours, rate) {
	return Math.round(principal * Math.pow(1 + rate, hours) - principal);
}

// 借金キーを生成（Notion連携対応）
async function generateLoanKey(lenderId, borrowerId) {
	const lenderKey = await getDataKey(lenderId);
	const borrowerKey = await getDataKey(borrowerId);
	return `${lenderKey}_${borrowerKey}`;
}

// 借金キーを検索（Notion名とDiscord IDの両方をチェック）
async function findLoanKey(lenderId, borrowerId, loanData) {
	// まずNotion名で試す
	const lenderKey = await getDataKey(lenderId);
	const borrowerKey = await getDataKey(borrowerId);
	const notionKey = `${lenderKey}_${borrowerKey}`;
	if (loanData[notionKey]) {
		return notionKey;
	}
	
	// Notion名で見つからない場合はDiscord IDで試す
	const idKey = `${lenderId}_${borrowerId}`;
	if (loanData[idKey]) {
		return idKey;
	}
	
	// どちらでも見つからない場合は、既存のデータを検索（移行用）
	for (const [key, loan] of Object.entries(loanData)) {
		if (loan.lenderId === lenderId && loan.borrowerId === borrowerId) {
			return key;
		}
	}
	
	return null;
}

// 進行中の借金リクエスト管理
const pendingLoanRequests = new Map(); // requestId -> { lenderId, borrowerId, amount, days, createdAt, messageId }

// 借金データの移行処理（Notion連携対応）
async function migrateLoanData(userId, loanData) {
	let migrated = false;
	
	// 借り手としての借金を移行
	for (const [key, loan] of Object.entries(loanData)) {
		if (loan.borrowerId === userId) {
			const newKey = await generateLoanKey(loan.lenderId, loan.borrowerId);
			if (key !== newKey) {
				loanData[newKey] = loanData[key];
				delete loanData[key];
				migrated = true;
			}
		}
	}
	
	// 貸し手としての借金を移行
	for (const [key, loan] of Object.entries(loanData)) {
		if (loan.lenderId === userId) {
			const newKey = await generateLoanKey(loan.lenderId, loan.borrowerId);
			if (key !== newKey) {
				loanData[newKey] = loanData[key];
				delete loanData[key];
				migrated = true;
			}
		}
	}
	
	if (migrated) {
		saveLoanData(loanData);
	}
}

// 世代ロールチェック関数
function checkGenerationRole(member) {
	const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
	return (
		member.roles.cache.some((r) => romanRegex.test(r.name)) ||
		member.roles.cache.has(CURRENT_GENERATION_ROLE_ID)
	);
}

// 銀行機能
async function handleBankDeposit(interaction, client) {
	try {
		// 世代ロールチェック
		if (!checkGenerationRole(interaction.member)) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('銀行機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const userId = interaction.user.id;
		const amount = interaction.options.getInteger('amount');

		if (!amount || amount <= 0) {
			return interaction.reply({
				content: '有効な金額（1以上）を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const currentBalance = await getRomecoin(userId);
		if (currentBalance < amount) {
			return interaction.reply({
				content: `ロメコインが不足しています。\n現在の所持: ${ROMECOIN_EMOJI}${currentBalance.toLocaleString()}\n必要な額: ${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 銀行データを読み込み（Notion連携対応）
		const bankData = loadBankData();
		const userBankData = await getData(userId, bankData, {
			deposit: 0,
			lastInterestTime: Date.now(),
		});

		// 利子を計算して追加
		const now = Date.now();
		const hoursPassed = (now - userBankData.lastInterestTime) / INTEREST_INTERVAL_MS;
		if (hoursPassed > 0) {
			const interest = calculateInterest(userBankData.deposit, hoursPassed, INTEREST_RATE_PER_HOUR);
			if (interest > 0) {
				userBankData.deposit += interest;
			}
			userBankData.lastInterestTime = now;
		}

		// 預金を追加
		userBankData.deposit += amount;
		await updateData(userId, bankData, () => userBankData);
		saveBankData(bankData);

		// ロメコインを減額
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) - amount),
			{
				log: true,
				client: client,
				reason: `黒須銀行への預金`,
				metadata: {
					commandName: 'bank_deposit',
				},
			}
		);

		const embed = new EmbedBuilder()
			.setTitle('💰 預金完了')
			.setDescription(`黒須銀行に ${ROMECOIN_EMOJI}${amount.toLocaleString()} を預金しました。`)
			.addFields(
				{
					name: '現在の預金額',
					value: `${ROMECOIN_EMOJI}${userBankData.deposit.toLocaleString()}`,
					inline: true,
				},
				{
					name: '利子率',
					value: `${(INTEREST_RATE_PER_HOUR * 100).toFixed(3)}%/時間`,
					inline: true,
				}
			)
			.setColor(0x00ff00)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[Bank] 預金エラー:', error);
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

async function handleBankWithdraw(interaction, client) {
	try {
		// 世代ロールチェック
		if (!checkGenerationRole(interaction.member)) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('銀行機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const userId = interaction.user.id;
		const amount = interaction.options.getInteger('amount');

		if (!amount || amount <= 0) {
			return interaction.reply({
				content: '有効な金額（1以上）を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 銀行データを読み込み（Notion連携対応）
		const bankData = loadBankData();
		const userBankData = await getData(userId, bankData, {
			deposit: 0,
			lastInterestTime: Date.now(),
		});

		if (!userBankData || userBankData.deposit === 0) {
			return interaction.reply({
				content: '預金がありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 利子を計算して追加
		const now = Date.now();
		const hoursPassed = (now - userBankData.lastInterestTime) / INTEREST_INTERVAL_MS;
		if (hoursPassed > 0) {
			const interest = calculateInterest(userBankData.deposit, hoursPassed, INTEREST_RATE_PER_HOUR);
			if (interest > 0) {
				userBankData.deposit += interest;
			}
			userBankData.lastInterestTime = now;
		}

		if (userBankData.deposit < amount) {
			return interaction.reply({
				content: `預金額が不足しています。\n現在の預金額: ${ROMECOIN_EMOJI}${userBankData.deposit.toLocaleString()}\n引き出し額: ${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 預金を減額
		userBankData.deposit -= amount;
		await updateData(userId, bankData, () => userBankData);
		saveBankData(bankData);

		// ロメコインを追加
		await updateRomecoin(
			userId,
			(current) => Math.round((current || 0) + amount),
			{
				log: true,
				client: client,
				reason: `黒須銀行からの引き出し`,
				metadata: {
					commandName: 'bank_withdraw',
				},
			}
		);

		const embed = new EmbedBuilder()
			.setTitle('💰 引き出し完了')
			.setDescription(`黒須銀行から ${ROMECOIN_EMOJI}${amount.toLocaleString()} を引き出しました。`)
			.addFields({
				name: '残りの預金額',
				value: `${ROMECOIN_EMOJI}${userBankData.deposit.toLocaleString()}`,
				inline: true,
			})
			.setColor(0x00ff00)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[Bank] 引き出しエラー:', error);
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

async function handleBankInfo(interaction, client) {
	try {
		// 世代ロールチェック
		if (!checkGenerationRole(interaction.member)) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('銀行機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const userId = interaction.user.id;

		// 銀行データを読み込み（Notion連携対応）
		const bankData = loadBankData();
		const userBankData = await getData(userId, bankData, {
			deposit: 0,
			lastInterestTime: Date.now(),
		});

		// 利子を計算して追加
		const now = Date.now();
		const hoursPassed = (now - userBankData.lastInterestTime) / INTEREST_INTERVAL_MS;
		let interest = 0;
		if (hoursPassed > 0) {
			interest = calculateInterest(userBankData.deposit, hoursPassed, INTEREST_RATE_PER_HOUR);
			if (interest > 0) {
				userBankData.deposit += interest;
				userBankData.lastInterestTime = now;
				await updateData(userId, bankData, () => userBankData);
				saveBankData(bankData);
			}
		}

		// 銀行の合計額を計算（全ユーザーのデータを集計）
		const totalDeposit = Object.values(bankData).reduce((sum, data) => {
			if (data && typeof data === 'object' && 'deposit' in data) {
				return sum + (data.deposit || 0);
			}
			return sum;
		}, 0);

		const embed = new EmbedBuilder()
			.setTitle('🏦 黒須銀行')
			.setDescription('あなたの預金情報')
			.addFields(
				{
					name: 'あなたの預金額',
					value: `${ROMECOIN_EMOJI}${userBankData.deposit.toLocaleString()}`,
					inline: true,
				},
				{
					name: '銀行の合計預金額',
					value: `${ROMECOIN_EMOJI}${totalDeposit.toLocaleString()}`,
					inline: true,
				},
				{
					name: '利子率',
					value: `${(INTEREST_RATE_PER_HOUR * 100).toFixed(3)}%/時間`,
					inline: true,
				}
			)
			.setColor(0x0099ff)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[Bank] 情報取得エラー:', error);
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

// 借金機能
async function handleLoanRequest(interaction, client) {
	try {
		// 世代ロールチェック
		if (!checkGenerationRole(interaction.member)) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('借金機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const lenderId = interaction.user.id;
		const borrower = interaction.options.getUser('borrower');
		const amount = interaction.options.getInteger('amount');

		if (!borrower) {
			return interaction.reply({
				content: '借金を貸す相手を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (borrower.id === lenderId) {
			return interaction.reply({
				content: '自分自身に借金を貸すことはできません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (borrower.bot) {
			return interaction.reply({
				content: 'Botに借金を貸すことはできません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// クロスロイド（このBot自身）への借金を防ぐ
		if (borrower.id === client.user.id) {
			return interaction.reply({
				content: 'クロスロイドに借金を貸すことはできません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (!amount || amount <= 0) {
			return interaction.reply({
				content: '有効な金額（1以上）を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const lenderBalance = await getRomecoin(lenderId);
		if (lenderBalance < amount) {
			return interaction.reply({
				content: `ロメコインが不足しています。\n現在の所持: ${ROMECOIN_EMOJI}${lenderBalance.toLocaleString()}\n必要な額: ${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 借金データを読み込み（Notion連携対応）
		const loanData = loadLoanData();
		const loanKey = await generateLoanKey(lenderId, borrower.id);
		
		// 既存の借金を検索（移行用）
		const existingKey = await findLoanKey(lenderId, borrower.id, loanData);
		if (existingKey) {
			// 既存のキーと新しいキーが異なる場合は移行
			if (existingKey !== loanKey) {
				loanData[loanKey] = loanData[existingKey];
				delete loanData[existingKey];
				saveLoanData(loanData);
			}
			return interaction.reply({
				content: 'このユーザーには既に借金があります。返済後に新しい借金を作成できます。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 返済期限を取得（日数、デフォルトは7日）
		const days = interaction.options.getInteger('days') || 7;
		if (days < 1 || days > 365) {
			return interaction.reply({
				content: '返済期限は1日以上365日以下で指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 借金リクエストIDを生成
		const requestId = `loan_${lenderId}_${borrower.id}_${Date.now()}`;

		// 同意ボタンを作成
		const agreeButton = new ButtonBuilder()
			.setCustomId(`loan_agree_${requestId}`)
			.setLabel('借金を受ける')
			.setStyle(ButtonStyle.Success)
			.setEmoji('✅');

		const cancelButton = new ButtonBuilder()
			.setCustomId(`loan_cancel_${requestId}`)
			.setLabel('キャンセル')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('❌');

		const row = new ActionRowBuilder().addComponents([agreeButton, cancelButton]);

		const embed = new EmbedBuilder()
			.setTitle('💳 借金リクエスト')
			.setDescription(
				`**貸し手:** ${interaction.user}\n**借り手:** ${borrower}\n**金額:** ${ROMECOIN_EMOJI}${amount.toLocaleString()}\n**返済期限:** ${days}日\n**利子率:** ${(LOAN_INTEREST_RATE_PER_HOUR * 100).toFixed(3)}%/時間\n\n${borrower} の同意を待っています。`
			)
			.setColor(0xffff00)
			.setTimestamp();

		// 借り手をメンション
		const reply = await interaction.reply({
			content: `${borrower} 借金のリクエストがあります。同意してください。`,
			embeds: [embed],
			components: [row],
		});

		// リクエストを保存
		pendingLoanRequests.set(requestId, {
			lenderId: lenderId,
			borrowerId: borrower.id,
			amount: amount,
			days: days,
			createdAt: Date.now(),
			messageId: reply.id,
		});

		// タイムアウト処理（30秒）
		setTimeout(async () => {
			const request = pendingLoanRequests.get(requestId);
			if (request) {
				pendingLoanRequests.delete(requestId);
				try {
					const message = await interaction.channel.messages.fetch(request.messageId).catch(() => null);
					if (message) {
						const timeoutEmbed = new EmbedBuilder()
							.setTitle('⏰ タイムアウト')
							.setDescription('借り手の同意が得られなかったため、借金リクエストはキャンセルされました。')
							.setColor(0xff0000)
							.setTimestamp();
						await message.edit({ embeds: [timeoutEmbed], components: [] });
					}
				} catch (e) {
					console.error('[Loan] タイムアウトメッセージ編集エラー:', e);
				}
			}
		}, 30 * 1000);
	} catch (error) {
		console.error('[Loan] 借金作成エラー:', error);
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

async function handleLoanRepay(interaction, client) {
	try {
		// 世代ロールチェック
		if (!checkGenerationRole(interaction.member)) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('借金機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const borrowerId = interaction.user.id;
		const lender = interaction.options.getUser('lender');

		if (!lender) {
			return interaction.reply({
				content: '返済する相手を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 借金データを読み込み（Notion連携対応）
		const loanData = loadLoanData();
		const loanKey = await generateLoanKey(lender.id, borrowerId);
		
		// 既存の借金を検索（移行用）
		let existingKey = await findLoanKey(lender.id, borrowerId, loanData);
		if (!existingKey) {
			return interaction.reply({
				content: 'このユーザーへの借金はありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 既存のキーと新しいキーが異なる場合は移行
		if (existingKey !== loanKey) {
			loanData[loanKey] = loanData[existingKey];
			delete loanData[existingKey];
			saveLoanData(loanData);
		}

		const loan = loanData[loanKey];

		// 利子を計算
		const now = Date.now();
		const hoursPassed = (now - loan.lastInterestTime) / INTEREST_INTERVAL_MS;
		if (hoursPassed > 0) {
			const interest = calculateInterest(loan.principal, hoursPassed, LOAN_INTEREST_RATE_PER_HOUR);
			loan.interest += interest;
			loan.lastInterestTime = now;
		}

		const totalAmount = loan.principal + loan.interest;
		const borrowerBalance = await getRomecoin(borrowerId);
		const isOverdue = loan.dueDate && Date.now() > loan.dueDate;
		
		// 返済期限が過ぎている場合は強制返済（マイナスになっても返済）
		if (isOverdue) {
			// 強制返済を実行
			await forceRepayLoan(loanKey, loan, client);
			
			const embed = new EmbedBuilder()
				.setTitle('⚠️ 強制返済完了')
				.setDescription(`返済期限が過ぎていたため、強制返済が実行されました。`)
				.addFields(
					{
						name: '返済額',
						value: `${ROMECOIN_EMOJI}${totalAmount.toLocaleString()}`,
						inline: true,
					},
					{
						name: '返済後の残高',
						value: `${ROMECOIN_EMOJI}${(borrowerBalance - totalAmount).toLocaleString()}`,
						inline: true,
					}
				)
				.setColor(0xff0000)
				.setTimestamp();
			
			return interaction.reply({ embeds: [embed] });
		}

		if (borrowerBalance < totalAmount) {
			return interaction.reply({
				content: `ロメコインが不足しています。\n現在の所持: ${ROMECOIN_EMOJI}${borrowerBalance.toLocaleString()}\n返済額: ${ROMECOIN_EMOJI}${totalAmount.toLocaleString()} (元金: ${ROMECOIN_EMOJI}${loan.principal.toLocaleString()}, 利子: ${ROMECOIN_EMOJI}${loan.interest.toLocaleString()})\n\n⚠️ 返済期限: ${loan.dueDate ? new Date(loan.dueDate).toLocaleString('ja-JP') : '未設定'}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 借り手のロメコインを減額
		await updateRomecoin(
			borrowerId,
			(current) => Math.round((current || 0) - totalAmount),
			{
				log: true,
				client: client,
				reason: `借金の返済: ${lender.tag} へ`,
				metadata: {
					commandName: 'loan_repay',
					targetUserId: lender.id,
				},
			}
		);

		// 貸し手のロメコインを追加
		await updateRomecoin(
			lender.id,
			(current) => Math.round((current || 0) + totalAmount),
			{
				log: true,
				client: client,
				reason: `借金の返済受取: ${interaction.user.tag} から`,
				metadata: {
					commandName: 'loan_repay',
					targetUserId: borrowerId,
				},
			}
		);

		// 借金を削除
		delete loanData[loanKey];
		saveLoanData(loanData);

		const embed = new EmbedBuilder()
			.setTitle('✅ 返済完了')
			.setDescription(`${lender} への借金を返済しました。`)
			.addFields(
				{
					name: '返済額',
					value: `${ROMECOIN_EMOJI}${totalAmount.toLocaleString()}`,
					inline: true,
				},
				{
					name: '内訳',
					value: `元金: ${ROMECOIN_EMOJI}${loan.principal.toLocaleString()}\n利子: ${ROMECOIN_EMOJI}${loan.interest.toLocaleString()}`,
					inline: false,
				}
			)
			.setColor(0x00ff00)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[Loan] 返済エラー:', error);
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

async function handleLoanInfo(interaction, client) {
	try {
		// 世代ロールチェック
		if (!checkGenerationRole(interaction.member)) {
			const errorEmbed = new EmbedBuilder()
				.setTitle('❌ エラー')
				.setDescription('借金機能を利用するには世代ロールが必要です。')
				.setColor(0xff0000);
			return interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => {});
		}

		const userId = interaction.user.id;

		// 借金データを読み込み
		const loanData = loadLoanData();
		
		// 借金データの移行処理（Notion連携対応）
		await migrateLoanData(userId, loanData);
		
		// 借り手としての借金
		const loansAsBorrower = Object.entries(loanData)
			.filter(([key, loan]) => loan.borrowerId === userId)
			.map(([key, loan]) => {
				const now = Date.now();
				const hoursPassed = (now - loan.lastInterestTime) / INTEREST_INTERVAL_MS;
				let interest = loan.interest;
				if (hoursPassed > 0) {
					interest += calculateInterest(loan.principal, hoursPassed, LOAN_INTEREST_RATE_PER_HOUR);
				}
				return { ...loan, currentInterest: interest, lenderId: loan.lenderId };
			});

		// 貸し手としての借金
		const loansAsLender = Object.entries(loanData)
			.filter(([key, loan]) => loan.lenderId === userId)
			.map(([key, loan]) => {
				const now = Date.now();
				const hoursPassed = (now - loan.lastInterestTime) / INTEREST_INTERVAL_MS;
				let interest = loan.interest;
				if (hoursPassed > 0) {
					interest += calculateInterest(loan.principal, hoursPassed, LOAN_INTEREST_RATE_PER_HOUR);
				}
				return { ...loan, currentInterest: interest, borrowerId: loan.borrowerId };
			});

		if (loansAsBorrower.length === 0 && loansAsLender.length === 0) {
			return interaction.reply({
				content: '借金情報がありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const embed = new EmbedBuilder()
			.setTitle('💳 借金情報')
			.setColor(0xffa500)
			.setTimestamp();

		if (loansAsBorrower.length > 0) {
			const borrowerText = loansAsBorrower
				.map((loan) => {
					const lender = client.users.cache.get(loan.lenderId);
					const lenderName = lender ? lender.tag : `<@${loan.lenderId}>`;
					const total = loan.principal + loan.currentInterest;
					const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
					const isOverdue = dueDate && Date.now() > dueDate;
					const dueDateText = dueDate 
						? `${dueDate.toLocaleString('ja-JP')} ${isOverdue ? '⚠️ **期限切れ**' : ''}`
						: '未設定';
					return `**${lenderName}** への借金\n元金: ${ROMECOIN_EMOJI}${loan.principal.toLocaleString()}\n利子: ${ROMECOIN_EMOJI}${loan.currentInterest.toLocaleString()}\n合計: ${ROMECOIN_EMOJI}${total.toLocaleString()}\n返済期限: ${dueDateText}`;
				})
				.join('\n\n');
			embed.addFields({ name: '📥 借りている借金', value: borrowerText, inline: false });
		}

		if (loansAsLender.length > 0) {
			const lenderText = loansAsLender
				.map((loan) => {
					const borrower = client.users.cache.get(loan.borrowerId);
					const borrowerName = borrower ? borrower.tag : `<@${loan.borrowerId}>`;
					const total = loan.principal + loan.currentInterest;
					const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
					const isOverdue = dueDate && Date.now() > dueDate;
					const dueDateText = dueDate 
						? `${dueDate.toLocaleString('ja-JP')} ${isOverdue ? '⚠️ **期限切れ**' : ''}`
						: '未設定';
					return `**${borrowerName}** への貸付\n元金: ${ROMECOIN_EMOJI}${loan.principal.toLocaleString()}\n利子: ${ROMECOIN_EMOJI}${loan.currentInterest.toLocaleString()}\n合計: ${ROMECOIN_EMOJI}${total.toLocaleString()}\n返済期限: ${dueDateText}`;
				})
				.join('\n\n');
			embed.addFields({ name: '📤 貸している借金', value: lenderText, inline: false });
		}

		await interaction.reply({ embeds: [embed] });
	} catch (error) {
		console.error('[Loan] 情報取得エラー:', error);
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

// 強制返済を実行する関数
async function forceRepayLoan(loanKey, loan, client) {
	try {
		const loanData = loadLoanData();
		
		// 利子を計算
		const now = Date.now();
		const hoursPassed = (now - loan.lastInterestTime) / INTEREST_INTERVAL_MS;
		if (hoursPassed > 0) {
			const interest = calculateInterest(loan.principal, hoursPassed, LOAN_INTEREST_RATE_PER_HOUR);
			loan.interest += interest;
			loan.lastInterestTime = now;
		}
		
		const totalAmount = loan.principal + loan.interest;
		const borrowerBalance = await getRomecoin(loan.borrowerId);
		
		// 借り手のロメコインを減額（マイナスになっても強制返済）
		await updateRomecoin(
			loan.borrowerId,
			(current) => Math.round((current || 0) - totalAmount),
			{
				log: true,
				client: client,
				reason: `借金の強制返済: ${loan.lenderId} へ`,
				metadata: {
					commandName: 'loan_force_repay',
					targetUserId: loan.lenderId,
				},
			}
		);
		
		// 貸し手のロメコインを追加
		await updateRomecoin(
			loan.lenderId,
			(current) => Math.round((current || 0) + totalAmount),
			{
				log: true,
				client: client,
				reason: `借金の強制返済受取: ${loan.borrowerId} から`,
				metadata: {
					commandName: 'loan_force_repay',
					targetUserId: loan.borrowerId,
				},
			}
		);
		
		// 借金を削除
		delete loanData[loanKey];
		saveLoanData(loanData);
		
		// 借り手に通知を送信
		try {
			const borrower = await client.users.fetch(loan.borrowerId);
			if (borrower) {
				const embed = new EmbedBuilder()
					.setTitle('⚠️ 借金の強制返済')
					.setDescription(`返済期限が過ぎていたため、借金が強制返済されました。`)
					.addFields(
						{
							name: '返済額',
							value: `${ROMECOIN_EMOJI}${totalAmount.toLocaleString()}`,
							inline: true,
						},
						{
							name: '返済後の残高',
							value: `${ROMECOIN_EMOJI}${(borrowerBalance - totalAmount).toLocaleString()}`,
							inline: true,
						}
					)
					.setColor(0xff0000)
					.setTimestamp();
				
				await borrower.send({ embeds: [embed] }).catch(() => {
					// DM送信に失敗しても無視
				});
			}
		} catch (e) {
			// 通知送信に失敗しても無視
		}
	} catch (error) {
		console.error('[Loan] 強制返済エラー:', error);
	}
}

// 期限切れの借金をチェックして強制返済を実行
async function checkOverdueLoans(client) {
	try {
		const loanData = loadLoanData();
		const now = Date.now();
		const overdueLoans = [];
		
		// 期限切れの借金を検索
		for (const [loanKey, loan] of Object.entries(loanData)) {
			if (loan.dueDate && now > loan.dueDate) {
				// 借金データの移行処理（Notion連携対応）
				const newKey = await generateLoanKey(loan.lenderId, loan.borrowerId);
				if (loanKey !== newKey) {
					loanData[newKey] = loanData[loanKey];
					delete loanData[loanKey];
					saveLoanData(loanData);
					overdueLoans.push({ loanKey: newKey, loan });
				} else {
					overdueLoans.push({ loanKey, loan });
				}
			}
		}
		
		// 期限切れの借金を強制返済
		for (const { loanKey, loan } of overdueLoans) {
			await forceRepayLoan(loanKey, loan, client);
		}
		
		if (overdueLoans.length > 0) {
			console.log(`[Loan] ${overdueLoans.length}件の期限切れ借金を強制返済しました`);
		}
	} catch (error) {
		console.error('[Loan] 期限切れチェックエラー:', error);
	}
}

async function handleLoanAgreement(interaction, client) {
	try {
		const requestId = interaction.customId.replace('loan_agree_', '');
		const request = pendingLoanRequests.get(requestId);

		if (!request) {
			return interaction.reply({
				content: 'この借金リクエストは既に処理済みまたは期限切れです。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		if (interaction.user.id !== request.borrowerId) {
			return interaction.reply({
				content: 'あなたはこの借金リクエストの借り手ではありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 借金データを読み込み（Notion連携対応）
		const loanData = loadLoanData();
		const loanKey = await generateLoanKey(request.lenderId, request.borrowerId);
		
		// 既存の借金を検索（移行用）
		const existingKey = await findLoanKey(request.lenderId, request.borrowerId, loanData);
		if (existingKey) {
			pendingLoanRequests.delete(requestId);
			return interaction.reply({
				content: 'このユーザーには既に借金があります。返済後に新しい借金を作成できます。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		const lenderBalance = await getRomecoin(request.lenderId);
		if (lenderBalance < request.amount) {
			pendingLoanRequests.delete(requestId);
			return interaction.reply({
				content: `貸し手のロメコインが不足しています。\n現在の所持: ${ROMECOIN_EMOJI}${lenderBalance.toLocaleString()}\n必要な額: ${ROMECOIN_EMOJI}${request.amount.toLocaleString()}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		const dueDate = Date.now() + (request.days * 24 * 60 * 60 * 1000);

		// 借金を作成
		loanData[loanKey] = {
			lenderId: request.lenderId,
			borrowerId: request.borrowerId,
			principal: request.amount,
			interest: 0,
			createdAt: Date.now(),
			lastInterestTime: Date.now(),
			dueDate: dueDate,
			days: request.days,
		};
		saveLoanData(loanData);

		// 貸し手のロメコインを減額
		const lender = await client.users.fetch(request.lenderId).catch(() => null);
		await updateRomecoin(
			request.lenderId,
			(current) => Math.round((current || 0) - request.amount),
			{
				log: true,
				client: client,
				reason: `借金の貸付: ${interaction.user.tag} へ`,
				metadata: {
					commandName: 'loan_request',
					targetUserId: request.borrowerId,
				},
			}
		);

		// 借り手のロメコインを追加
		await updateRomecoin(
			request.borrowerId,
			(current) => Math.round((current || 0) + request.amount),
			{
				log: true,
				client: client,
				reason: `借金の受取: ${lender ? lender.tag : 'Unknown'} から`,
				metadata: {
					commandName: 'loan_request',
					targetUserId: request.lenderId,
				},
			}
		);

		// リクエストを削除
		pendingLoanRequests.delete(requestId);

		const embed = new EmbedBuilder()
			.setTitle('💳 借金作成完了')
			.setDescription(`${interaction.user} が借金を受け取りました。`)
			.addFields(
				{
					name: '貸し手',
					value: `<@${request.lenderId}>`,
					inline: true,
				},
				{
					name: '借り手',
					value: `<@${request.borrowerId}>`,
					inline: true,
				},
				{
					name: '元金',
					value: `${ROMECOIN_EMOJI}${request.amount.toLocaleString()}`,
					inline: true,
				},
				{
					name: '返済期限',
					value: `${request.days}日`,
					inline: true,
				},
				{
					name: '利子率',
					value: `${(LOAN_INTEREST_RATE_PER_HOUR * 100).toFixed(3)}%/時間`,
					inline: true,
				}
			)
			.setColor(0x00ff00)
			.setTimestamp();

		await interaction.update({ embeds: [embed], components: [] });
	} catch (error) {
		console.error('[Loan] 同意処理エラー:', error);
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

async function handleLoanCancel(interaction, client) {
	try {
		const requestId = interaction.customId.replace('loan_cancel_', '');
		const request = pendingLoanRequests.get(requestId);

		if (!request) {
			return interaction.reply({
				content: 'この借金リクエストは既に処理済みまたは期限切れです。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 貸し手または借り手のみがキャンセル可能
		if (interaction.user.id !== request.lenderId && interaction.user.id !== request.borrowerId) {
			return interaction.reply({
				content: 'あなたはこの借金リクエストの当事者ではありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// リクエストを削除
		pendingLoanRequests.delete(requestId);

		const embed = new EmbedBuilder()
			.setTitle('❌ 借金リクエストキャンセル')
			.setDescription(`${interaction.user} により借金リクエストがキャンセルされました。`)
			.setColor(0xff0000)
			.setTimestamp();

		await interaction.update({ embeds: [embed], components: [] });
	} catch (error) {
		console.error('[Loan] キャンセル処理エラー:', error);
		if (error.code !== 10062 && error.code !== 40060) {
			try {
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: 'エラーが発生しました。',
						flags: [MessageFlags.Ephemeral],
					});
				}
			} catch (e) {
				// エラーを無視
			}
		}
	}
}

// クロスロイドの所持金を黒須銀行の預金として移行
async function migrateBotBalanceToBank(client, specificBotId = null) {
	try {
		const botUserId = specificBotId || client.user?.id;
		if (!botUserId) {
			console.log('[Bank] BotユーザーIDが取得できません。移行をスキップします。');
			return;
		}

		// Botの現在のロメコイン残高を取得
		const botBalance = await getRomecoin(botUserId);
		if (botBalance <= 0) {
			console.log(`[Bank] Bot(${botUserId})のロメコイン残高が0以下です。移行をスキップします。`);
			return;
		}

		// 銀行データを読み込み
		const bankData = loadBankData();
		
		// Botの銀行データを取得（Notion連携対応）
		const botBankData = await getData(botUserId, bankData, {
			deposit: 0,
			lastInterestTime: Date.now(),
		});

		// 既に預金がある場合は、現在の残高を追加
		if (botBankData.deposit > 0) {
			console.log(`[Bank] Botの既存預金: ${ROMECOIN_EMOJI}${botBankData.deposit.toLocaleString()}`);
		}

		// Botのロメコイン残高を預金に追加
		const previousDeposit = botBankData.deposit;
		botBankData.deposit += botBalance;
		botBankData.lastInterestTime = Date.now();

		// 銀行データを更新
		await updateData(botUserId, bankData, () => botBankData);
		saveBankData(bankData);

		// Botのロメコイン残高を0にする
		await updateRomecoin(
			botUserId,
			() => 0,
			{
				log: true,
				client: client,
				reason: `黒須銀行への預金移行（所持金を預金に移行）`,
				metadata: {
					commandName: 'bank_migrate_bot_balance',
				},
			}
		);

		console.log(
			`[Bank] クロスロイド(${botUserId})の所持金を黒須銀行の預金として移行しました。\n` +
			`  移行前の所持金: ${ROMECOIN_EMOJI}${botBalance.toLocaleString()}\n` +
			`  移行前の預金: ${ROMECOIN_EMOJI}${previousDeposit.toLocaleString()}\n` +
			`  移行後の預金: ${ROMECOIN_EMOJI}${botBankData.deposit.toLocaleString()}`
		);
	} catch (error) {
		console.error('[Bank] Bot残高の銀行移行エラー:', error);
	}
}

module.exports = {
	handleBankDeposit,
	handleBankWithdraw,
	handleBankInfo,
	handleLoanRequest,
	handleLoanRepay,
	handleLoanInfo,
	handleLoanAgreement,
	handleLoanCancel,
	loadBankData,
	loadLoanData,
	checkOverdueLoans,
	migrateLoanData,
	migrateBotBalanceToBank,
};

