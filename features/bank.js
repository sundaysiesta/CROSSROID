const { EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { updateRomecoin, getRomecoin } = require('./romecoin');
const { getData, updateData, migrateData } = require('./dataAccess');

const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';
const BANK_DATA_FILE = path.join(__dirname, '..', 'bank_data.json');
const LOAN_DATA_FILE = path.join(__dirname, '..', 'loan_data.json');

// 銀行の利子率（1時間ごとに0.1%）
const INTEREST_RATE_PER_HOUR = 0.001;
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

// 銀行機能
async function handleBankDeposit(interaction, client) {
	try {
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

		// 銀行データを読み込み
		const bankData = loadBankData();
		if (!bankData[userId]) {
			bankData[userId] = {
				deposit: 0,
				lastInterestTime: Date.now(),
			};
		}

		// 利子を計算して追加
		const now = Date.now();
		const hoursPassed = (now - bankData[userId].lastInterestTime) / INTEREST_INTERVAL_MS;
		if (hoursPassed > 0) {
			const interest = calculateInterest(bankData[userId].deposit, hoursPassed, INTEREST_RATE_PER_HOUR);
			if (interest > 0) {
				bankData[userId].deposit += interest;
			}
			bankData[userId].lastInterestTime = now;
		}

		// 預金を追加
		bankData[userId].deposit += amount;
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
					value: `${ROMECOIN_EMOJI}${bankData[userId].deposit.toLocaleString()}`,
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
		const userId = interaction.user.id;
		const amount = interaction.options.getInteger('amount');

		if (!amount || amount <= 0) {
			return interaction.reply({
				content: '有効な金額（1以上）を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 銀行データを読み込み
		const bankData = loadBankData();
		if (!bankData[userId]) {
			return interaction.reply({
				content: '預金がありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 利子を計算して追加
		const now = Date.now();
		const hoursPassed = (now - bankData[userId].lastInterestTime) / INTEREST_INTERVAL_MS;
		if (hoursPassed > 0) {
			const interest = calculateInterest(bankData[userId].deposit, hoursPassed, INTEREST_RATE_PER_HOUR);
			if (interest > 0) {
				bankData[userId].deposit += interest;
			}
			bankData[userId].lastInterestTime = now;
		}

		if (bankData[userId].deposit < amount) {
			return interaction.reply({
				content: `預金額が不足しています。\n現在の預金額: ${ROMECOIN_EMOJI}${bankData[userId].deposit.toLocaleString()}\n引き出し額: ${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 預金を減額
		bankData[userId].deposit -= amount;
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
				value: `${ROMECOIN_EMOJI}${bankData[userId].deposit.toLocaleString()}`,
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
		const userId = interaction.user.id;

		// 銀行データを読み込み
		const bankData = loadBankData();
		if (!bankData[userId]) {
			return interaction.reply({
				content: '預金がありません。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 利子を計算して追加
		const now = Date.now();
		const hoursPassed = (now - bankData[userId].lastInterestTime) / INTEREST_INTERVAL_MS;
		let interest = 0;
		if (hoursPassed > 0) {
			interest = calculateInterest(bankData[userId].deposit, hoursPassed, INTEREST_RATE_PER_HOUR);
			if (interest > 0) {
				bankData[userId].deposit += interest;
				bankData[userId].lastInterestTime = now;
				saveBankData(bankData);
			}
		}

		// 銀行の合計額を計算
		const totalDeposit = Object.values(bankData).reduce((sum, data) => sum + (data.deposit || 0), 0);

		const embed = new EmbedBuilder()
			.setTitle('🏦 黒須銀行')
			.setDescription('あなたの預金情報')
			.addFields(
				{
					name: 'あなたの預金額',
					value: `${ROMECOIN_EMOJI}${bankData[userId].deposit.toLocaleString()}`,
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

		// 借金データを読み込み
		const loanData = loadLoanData();
		const loanKey = `${lenderId}_${borrower.id}`;
		
		if (loanData[loanKey]) {
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

		const dueDate = Date.now() + (days * 24 * 60 * 60 * 1000);

		// 借金を作成
		loanData[loanKey] = {
			lenderId: lenderId,
			borrowerId: borrower.id,
			principal: amount,
			interest: 0,
			createdAt: Date.now(),
			lastInterestTime: Date.now(),
			dueDate: dueDate,
			days: days,
		};
		saveLoanData(loanData);

		// 貸し手のロメコインを減額
		await updateRomecoin(
			lenderId,
			(current) => Math.round((current || 0) - amount),
			{
				log: true,
				client: client,
				reason: `借金の貸付: ${borrower.tag} へ`,
				metadata: {
					commandName: 'loan_request',
					targetUserId: borrower.id,
				},
			}
		);

		// 借り手のロメコインを追加
		await updateRomecoin(
			borrower.id,
			(current) => Math.round((current || 0) + amount),
			{
				log: true,
				client: client,
				reason: `借金の受取: ${interaction.user.tag} から`,
				metadata: {
					commandName: 'loan_request',
					targetUserId: lenderId,
				},
			}
		);

		const embed = new EmbedBuilder()
			.setTitle('💳 借金作成完了')
			.setDescription(`${borrower} に ${ROMECOIN_EMOJI}${amount.toLocaleString()} を貸しました。`)
			.addFields(
				{
					name: '元金',
					value: `${ROMECOIN_EMOJI}${amount.toLocaleString()}`,
					inline: true,
				},
				{
					name: '利子率',
					value: `${(LOAN_INTEREST_RATE_PER_HOUR * 100).toFixed(3)}%/時間`,
					inline: true,
				}
			)
			.setColor(0xffa500)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
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
		const borrowerId = interaction.user.id;
		const lender = interaction.options.getUser('lender');

		if (!lender) {
			return interaction.reply({
				content: '返済する相手を指定してください。',
				flags: [MessageFlags.Ephemeral],
			});
		}

		// 借金データを読み込み
		const loanData = loadLoanData();
		const loanKey = `${lender.id}_${borrowerId}`;
		
		if (!loanData[loanKey]) {
			return interaction.reply({
				content: 'このユーザーへの借金はありません。',
				flags: [MessageFlags.Ephemeral],
			});
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
		const userId = interaction.user.id;

		// 借金データを読み込み
		const loanData = loadLoanData();
		
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
					return `**${borrowerName}** への貸付\n元金: ${ROMECOIN_EMOJI}${loan.principal.toLocaleString()}\n利子: ${ROMECOIN_EMOJI}${loan.currentInterest.toLocaleString()}\n合計: ${ROMECOIN_EMOJI}${total.toLocaleString()}`;
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
				overdueLoans.push({ loanKey, loan });
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

module.exports = {
	handleBankDeposit,
	handleBankWithdraw,
	handleBankInfo,
	handleLoanRequest,
	handleLoanRepay,
	handleLoanInfo,
	loadBankData,
	loadLoanData,
	checkOverdueLoans,
};

