const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getData, updateData, setData } = require('./dataAccess');
const { getRomecoin, updateRomecoin } = require('./romecoin');

const PARIMUTUEL_DATA_FILE = path.join(__dirname, '..', 'parimutuel_data.json');
const ROMECOIN_EMOJI = '<:romecoin2:1452874868415791236>';

// 手数料率（0% = 手数料なし）
const COMMISSION_RATE = 0;

// グローバル変数としてparimutuel_dataを初期化
let parimutuel_data = null;

// データ読み込み
function loadParimutuelData() {
	if (parimutuel_data !== null) {
		return parimutuel_data;
	}
	
	if (fs.existsSync(PARIMUTUEL_DATA_FILE)) {
		try {
			parimutuel_data = JSON.parse(fs.readFileSync(PARIMUTUEL_DATA_FILE, 'utf8'));
		} catch (e) {
			console.error('[Parimutuel] データ読み込みエラー:', e);
			parimutuel_data = {
				races: {},
				bets: {},
			};
		}
	} else {
		parimutuel_data = {
			races: {},
			bets: {},
		};
	}
	return parimutuel_data;
}

// データ保存
function saveParimutuelData() {
	if (parimutuel_data === null) {
		return;
	}
	try {
		fs.writeFileSync(PARIMUTUEL_DATA_FILE, JSON.stringify(parimutuel_data, null, 2));
	} catch (e) {
		console.error('[Parimutuel] データ保存エラー:', e);
	}
}

// 定期的にデータを保存（1分ごと）
setInterval(() => {
	saveParimutuelData();
}, 60 * 1000);

// レースを作成
async function createRace(raceId, name, candidates, creatorId) {
	const data = loadParimutuelData();
	
	if (data.races[raceId]) {
		throw new Error('このレースIDは既に使用されています');
	}
	
	if (candidates.length < 2) {
		throw new Error('候補者は2名以上必要です');
	}
	
	if (candidates.length > 20) {
		throw new Error('候補者は20名までです');
	}
	
	// 重複チェック
	const uniqueCandidates = [...new Set(candidates)];
	if (uniqueCandidates.length !== candidates.length) {
		throw new Error('候補者名に重複があります');
	}
	
	data.races[raceId] = {
		id: raceId,
		name,
		candidates,
		creatorId,
		status: 'open', // open, closed, finished
		createdAt: Date.now(),
		finishedAt: null,
		result: null,
	};
	
	saveParimutuelData();
	return data.races[raceId];
}

// レースを取得
function getRace(raceId) {
	const data = loadParimutuelData();
	return data.races[raceId] || null;
}

// すべてのレースを取得
function getAllRaces() {
	const data = loadParimutuelData();
	return Object.values(data.races);
}

// 賭けを購入
async function placeBet(userId, raceId, betType, selections, amount, client) {
	const data = loadParimutuelData();
	const race = data.races[raceId];
	
	if (!race) {
		throw new Error('レースが見つかりません');
	}
	
	if (race.status !== 'open') {
		throw new Error('このレースは既に締め切られています');
	}
	
	// 賭けの種類の検証（三連単のみ）
	const validBetTypes = ['sanrentan'];
	if (!validBetTypes.includes(betType)) {
		throw new Error('無効な賭けの種類です。三連単のみ利用可能です');
	}
	
	// 選択の検証
	if (!Array.isArray(selections) || selections.length === 0) {
		throw new Error('選択が無効です');
	}
	
	// 賭けの種類に応じた選択数の検証
	if (betType === 'sanrentan' && selections.length !== 3) {
		throw new Error('三連単は3名を選択してください');
	}
	
	// 選択が候補者に含まれているか確認
	for (const selection of selections) {
		if (!race.candidates.includes(selection)) {
			throw new Error(`候補者 "${selection}" が見つかりません`);
		}
	}
	
	// 三連単の重複チェック
	if (betType === 'sanrentan') {
		const uniqueSelections = [...new Set(selections)];
		if (uniqueSelections.length !== selections.length) {
			throw new Error('選択に重複があります');
		}
	}
	
	// 金額の検証
	if (amount < 100) {
		throw new Error('最低賭け金は100ロメコインです');
	}
	
	// ユーザーの残高を確認
	const balance = await getRomecoin(userId);
	if (balance < amount) {
		throw new Error('ロメコインが不足しています');
	}
	
	// ロメコインを減らす
	await updateRomecoin(userId, (current) => Math.round((current || 0) - amount), {
		log: true,
		client: client,
		reason: `パリミュチュエル賭け: ${race.name} (${betType})`,
		metadata: {
			commandName: 'parimutuel_bet',
			raceId,
			betType,
		},
		useDeposit: true,
	});
	
	// 賭けを記録
	const betId = `${raceId}_${userId}_${Date.now()}`;
	// 三連単の場合は順番を保持
	const betKey = `${betType}_${selections.join('_')}`;
	
	if (!data.bets[raceId]) {
		data.bets[raceId] = {};
	}
	if (!data.bets[raceId][betKey]) {
		data.bets[raceId][betKey] = {
			betType,
			selections: selections,
			totalAmount: 0,
			bets: [],
		};
	}
	
	data.bets[raceId][betKey].totalAmount += amount;
	data.bets[raceId][betKey].bets.push({
		betId,
		userId,
		amount,
		placedAt: Date.now(),
	});
	
	saveParimutuelData();
	
	return {
		betId,
		raceId,
		betType,
		selections,
		amount,
	};
}

// オッズを計算
function calculateOdds(raceId) {
	const data = loadParimutuelData();
	const race = data.races[raceId];
	
	if (!race) {
		return null;
	}
	
	if (!data.bets[raceId]) {
		return {};
	}
	
	const odds = {};
	
	// 各賭けの種類ごとに独立したプールを計算（三連単のみ）
	const pools = {
		sanrentan: { total: 0, bets: {} },
	};
	
	// 賭けを種類ごとに分類
	for (const betKey in data.bets[raceId]) {
		const betData = data.bets[raceId][betKey];
		const betType = betData.betType;
		
		// 三連単のみを処理
		if (pools[betType]) {
			pools[betType].total += betData.totalAmount;
			pools[betType].bets[betKey] = betData;
		}
	}
	
	// 各賭けの種類ごとにオッズを計算
	for (const betType in pools) {
		const pool = pools[betType];
		const payoutPool = pool.total * (1 - COMMISSION_RATE);
		
		for (const betKey in pool.bets) {
			const betData = pool.bets[betKey];
			const betAmount = betData.totalAmount;
			
			if (betAmount === 0) {
				odds[betKey] = null;
				continue;
			}
			
			// オッズ = 配当プール / その賭けへの賭け金
			const oddsValue = payoutPool / betAmount;
			odds[betKey] = {
				odds: oddsValue,
				display: `${oddsValue.toFixed(2)}倍`,
				totalAmount: betAmount,
				payoutPool,
				poolTotal: pool.total,
			};
		}
	}
	
	return odds;
}

// レースを締め切る
function closeRace(raceId) {
	const data = loadParimutuelData();
	const race = data.races[raceId];
	
	if (!race) {
		throw new Error('レースが見つかりません');
	}
	
	if (race.status !== 'open') {
		throw new Error('このレースは既に締め切られています');
	}
	
	race.status = 'closed';
	saveParimutuelData();
	
	return race;
}

// レースの結果を確定
async function setRaceResult(raceId, result, client) {
	const data = loadParimutuelData();
	const race = data.races[raceId];
	
	if (!race) {
		throw new Error('レースが見つかりません');
	}
	
	if (race.status === 'finished') {
		throw new Error('このレースの結果は既に確定しています');
	}
	
	// 結果の検証
	if (!Array.isArray(result) || result.length === 0) {
		throw new Error('結果が無効です');
	}
	
	// 結果が候補者に含まれているか確認
	for (const candidate of result) {
		if (!race.candidates.includes(candidate)) {
			throw new Error(`候補者 "${candidate}" が見つかりません`);
		}
	}
	
	// 結果の重複チェック
	const uniqueResult = [...new Set(result)];
	if (uniqueResult.length !== result.length) {
		throw new Error('結果に重複があります');
	}
	
	race.status = 'finished';
	race.finishedAt = Date.now();
	race.result = result;
	
	// 配当を計算して支払い
	if (data.bets[raceId]) {
		const odds = calculateOdds(raceId);
		const winners = new Set();
		
		// 各賭けの種類ごとに独立したプールで配当を計算
		
		// 複勝の配当（3着まで、各着順ごとに独立したプール）
		const fukushoPositions = result.slice(0, 3);
		for (const position of fukushoPositions) {
			const fukushoKey = `fukusho_${position}`;
			if (data.bets[raceId][fukushoKey] && odds[fukushoKey]) {
				const betData = data.bets[raceId][fukushoKey];
				const payoutPerBet = odds[fukushoKey].payoutPool / betData.totalAmount;
				for (const bet of betData.bets) {
					const payout = Math.floor(bet.amount * payoutPerBet);
					if (payout > 0) {
						await updateRomecoin(bet.userId, (current) => Math.round((current || 0) + payout), {
							log: true,
							client: client,
							reason: `パリミュチュエル配当: ${race.name} (複勝)`,
							metadata: {
								commandName: 'parimutuel_payout',
								raceId,
								betType: 'fukusho',
							},
						});
						winners.add(bet.userId);
					}
				}
			}
		}
		
		// ワイドの配当（3着以内の2名）
		if (result.length >= 3) {
			const top3 = result.slice(0, 3);
			// 3着以内の2名の組み合わせをすべてチェック
			for (let i = 0; i < top3.length; i++) {
				for (let j = i + 1; j < top3.length; j++) {
					const sortedPair = [top3[i], top3[j]].sort();
					const wideKey = `wide_${sortedPair[0]}_${sortedPair[1]}`;
					if (data.bets[raceId][wideKey] && odds[wideKey]) {
						const betData = data.bets[raceId][wideKey];
						const payoutPerBet = odds[wideKey].payoutPool / betData.totalAmount;
						for (const bet of betData.bets) {
							const payout = Math.floor(bet.amount * payoutPerBet);
							if (payout > 0) {
								await updateRomecoin(bet.userId, (current) => Math.round((current || 0) + payout), {
									log: true,
									client: client,
									reason: `パリミュチュエル配当: ${race.name} (ワイド)`,
									metadata: {
										commandName: 'parimutuel_payout',
										raceId,
										betType: 'wide',
									},
								});
								winners.add(bet.userId);
							}
						}
					}
				}
			}
		}
		
		
		// 三連単の配当（3着まで、順番通り）
		if (result.length >= 3) {
			const sanrentanKey = `sanrentan_${result[0]}_${result[1]}_${result[2]}`;
			if (data.bets[raceId][sanrentanKey] && odds[sanrentanKey]) {
				const betData = data.bets[raceId][sanrentanKey];
				const payoutPerBet = odds[sanrentanKey].payoutPool / betData.totalAmount;
				for (const bet of betData.bets) {
					const payout = Math.floor(bet.amount * payoutPerBet);
					if (payout > 0) {
						await updateRomecoin(bet.userId, (current) => Math.round((current || 0) + payout), {
							log: true,
							client: client,
							reason: `パリミュチュエル配当: ${race.name} (三連単)`,
							metadata: {
								commandName: 'parimutuel_payout',
								raceId,
								betType: 'sanrentan',
							},
						});
						winners.add(bet.userId);
					}
				}
			}
		}
	}
	
	saveParimutuelData();
	return race;
}

// ユーザーの賭けを取得
function getUserBets(userId, raceId = null) {
	const data = loadParimutuelData();
	const userBets = [];
	
	if (raceId) {
		if (!data.bets[raceId]) {
			return [];
		}
		for (const betKey in data.bets[raceId]) {
			const betData = data.bets[raceId][betKey];
			for (const bet of betData.bets) {
				if (bet.userId === userId) {
					userBets.push({
						betId: bet.betId,
						raceId,
						betType: betData.betType,
						selections: betData.selections,
						amount: bet.amount,
						placedAt: bet.placedAt,
					});
				}
			}
		}
	} else {
		for (const rId in data.bets) {
			for (const betKey in data.bets[rId]) {
				const betData = data.bets[rId][betKey];
				for (const bet of betData.bets) {
					if (bet.userId === userId) {
						userBets.push({
							betId: bet.betId,
							raceId: rId,
							betType: betData.betType,
							selections: betData.selections,
							amount: bet.amount,
							placedAt: bet.placedAt,
						});
					}
				}
			}
		}
	}
	
	return userBets;
}

// ベットを取り消す
async function cancelBet(userId, raceId, betId, client) {
	const data = loadParimutuelData();
	const race = data.races[raceId];
	
	if (!race) {
		throw new Error('レースが見つかりません');
	}
	
	if (race.status !== 'open') {
		throw new Error('このレースは既に締め切られているため、賭けを取り消せません');
	}
	
	if (!data.bets[raceId]) {
		throw new Error('賭けが見つかりません');
	}
	
	// 該当するベットを探す
	let foundBet = null;
	let foundBetKey = null;
	
	for (const betKey in data.bets[raceId]) {
		const betData = data.bets[raceId][betKey];
		const betIndex = betData.bets.findIndex(b => b.betId === betId && b.userId === userId);
		if (betIndex !== -1) {
			foundBet = betData.bets[betIndex];
			foundBetKey = betKey;
			break;
		}
	}
	
	if (!foundBet) {
		throw new Error('賭けが見つかりません');
	}
	
	// ロメコインを返金
	await updateRomecoin(userId, (current) => Math.round((current || 0) + foundBet.amount), {
		log: true,
		client: client,
		reason: `パリミュチュエル賭け取り消し: ${race.name}`,
		metadata: {
			commandName: 'parimutuel_cancel',
			raceId,
			betId,
		},
	});
	
	// ベットを削除
	const betData = data.bets[raceId][foundBetKey];
	betData.totalAmount -= foundBet.amount;
	betData.bets = betData.bets.filter(b => b.betId !== betId);
	
	// ベットが空になったら削除
	if (betData.bets.length === 0) {
		delete data.bets[raceId][foundBetKey];
	}
	
	// レースのベットが空になったら削除
	if (Object.keys(data.bets[raceId]).length === 0) {
		delete data.bets[raceId];
	}
	
	saveParimutuelData();
	
	return {
		betId,
		raceId,
		amount: foundBet.amount,
	};
}

// 現在開催中のレースで、無効なベット（単勝、ワイド、複勝）を自動返金
async function refundInvalidBets(client) {
	const data = loadParimutuelData();
	const invalidBetTypes = ['tansho', 'fukusho', 'wide', 'sanrenpuku'];
	let totalRefunded = 0;
	let totalUsers = 0;
	
	for (const raceId in data.races) {
		const race = data.races[raceId];
		if (race.status !== 'open') {
			continue; // 開催中でないレースはスキップ
		}
		
		if (!data.bets[raceId]) {
			continue;
		}
		
		const refundedUsers = new Set();
		
		for (const betKey in data.bets[raceId]) {
			const betData = data.bets[raceId][betKey];
			
			// 無効なベットタイプをチェック
			if (invalidBetTypes.includes(betData.betType)) {
				// すべてのベットを返金
				for (const bet of betData.bets) {
					try {
						await updateRomecoin(bet.userId, (current) => Math.round((current || 0) + bet.amount), {
							log: true,
							client: client,
							reason: `パリミュチュエル無効ベット返金: ${race.name} (${betData.betType})`,
							metadata: {
								commandName: 'parimutuel_refund',
								raceId,
								betType: betData.betType,
							},
						});
						totalRefunded += bet.amount;
						refundedUsers.add(bet.userId);
					} catch (error) {
						console.error(`[Parimutuel] 返金エラー (userId: ${bet.userId}, amount: ${bet.amount}):`, error);
					}
				}
				
				// ベットデータを削除
				delete data.bets[raceId][betKey];
			}
		}
		
		// レースのベットが空になったら削除
		if (data.bets[raceId] && Object.keys(data.bets[raceId]).length === 0) {
			delete data.bets[raceId];
		}
		
		totalUsers += refundedUsers.size;
	}
	
	saveParimutuelData();
	
	return {
		totalRefunded,
		totalUsers,
	};
}

module.exports = {
	loadParimutuelData,
	saveParimutuelData,
	createRace,
	getRace,
	getAllRaces,
	placeBet,
	calculateOdds,
	closeRace,
	setRaceResult,
	getUserBets,
	cancelBet,
	refundInvalidBets,
	COMMISSION_RATE,
};

