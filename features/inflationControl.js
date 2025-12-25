/**
 * インフレ対策機能
 * ロメコインシステムのインフレを抑制するための各種メカニズム
 */

const { getRomecoin } = require('./romecoin');

// 取引手数料率（1%）
const TRANSACTION_FEE_RATE = 0.01;

// 消費税率（5%）
const CONSUMPTION_TAX_RATE = 0.05;

// インフレ税の閾値と税率
const INFLATION_TAX_THRESHOLDS = [
	{ threshold: 1000000, rate: 0.001 }, // 100万以上: 0.1%/日
	{ threshold: 5000000, rate: 0.002 }, // 500万以上: 0.2%/日
	{ threshold: 10000000, rate: 0.005 }, // 1000万以上: 0.5%/日
];

/**
 * 取引手数料を計算
 * @param {number} amount - 取引額
 * @returns {number} 手数料
 */
function calculateTransactionFee(amount) {
	return Math.max(1, Math.round(amount * TRANSACTION_FEE_RATE));
}

/**
 * 消費税を計算
 * @param {number} price - 商品価格
 * @returns {number} 消費税額
 */
function calculateConsumptionTax(price) {
	return Math.round(price * CONSUMPTION_TAX_RATE);
}

/**
 * インフレ税を計算（所持金が多いほど税率が上がる）
 * @param {number} balance - 現在の残高
 * @returns {number} インフレ税額（1日あたり）
 */
function calculateInflationTax(balance) {
	for (let i = INFLATION_TAX_THRESHOLDS.length - 1; i >= 0; i--) {
		const { threshold, rate } = INFLATION_TAX_THRESHOLDS[i];
		if (balance >= threshold) {
			return Math.round(balance * rate);
		}
	}
	return 0;
}

/**
 * 取引手数料を適用した金額を計算
 * @param {number} amount - 元の金額
 * @returns {{netAmount: number, fee: number}} 手数料を差し引いた金額と手数料
 */
function applyTransactionFee(amount) {
	const fee = calculateTransactionFee(amount);
	const netAmount = amount - fee;
	return { netAmount: Math.max(0, netAmount), fee };
}

/**
 * 消費税込みの価格を計算
 * @param {number} price - 税抜き価格
 * @returns {{totalPrice: number, tax: number}} 税込み価格と消費税額
 */
function applyConsumptionTax(price) {
	const tax = calculateConsumptionTax(price);
	const totalPrice = price + tax;
	return { totalPrice, tax };
}

/**
 * ユーザーのインフレ税を計算（1日あたり）
 * @param {string} userId - ユーザーID
 * @returns {Promise<number>} インフレ税額
 */
async function getInflationTaxForUser(userId) {
	const balance = await getRomecoin(userId);
	return calculateInflationTax(balance);
}

/**
 * システム全体のロメコイン総量を推定（インフレ監視用）
 * @returns {Promise<{totalBalance: number, totalDeposit: number, total: number}>}
 */
async function estimateTotalRomecoin() {
	const romecoin = require('./romecoin');
	const bank = require('./bank');
	const fs = require('fs');
	const path = require('path');
	
	// ロメコインデータを読み込み
	const romecoinDataFile = path.join(__dirname, '..', 'romecoin_data.json');
	let romecoinData = {};
	if (fs.existsSync(romecoinDataFile)) {
		try {
			romecoinData = JSON.parse(fs.readFileSync(romecoinDataFile, 'utf8'));
		} catch (e) {
			console.error('[InflationControl] ロメコインデータ読み込みエラー:', e);
		}
	}
	
	// 銀行データを読み込み
	const bankData = bank.loadBankData();
	
	// 所持金の合計を計算
	let totalBalance = 0;
	for (const [key, value] of Object.entries(romecoinData)) {
		if (typeof value === 'number') {
			totalBalance += value;
		}
	}
	
	// 預金の合計を計算
	let totalDeposit = 0;
	for (const [key, data] of Object.entries(bankData)) {
		if (data && typeof data === 'object' && 'deposit' in data) {
			totalDeposit += data.deposit || 0;
		}
	}
	
	return {
		totalBalance,
		totalDeposit,
		total: totalBalance + totalDeposit,
	};
}

module.exports = {
	calculateTransactionFee,
	calculateConsumptionTax,
	calculateInflationTax,
	applyTransactionFee,
	applyConsumptionTax,
	getInflationTaxForUser,
	estimateTotalRomecoin,
	TRANSACTION_FEE_RATE,
	CONSUMPTION_TAX_RATE,
	INFLATION_TAX_THRESHOLDS,
};

