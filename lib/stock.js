const axios = require('axios');
const cheerio = require('cheerio');

// 株情報取得関数
async function getStockInfo(code) {
	const response = await axios.get(`https://finance.yahoo.co.jp/quote/${code}`);
	const $ = cheerio.load(response.data);

	const scriptText = $('script')
		.map((_, element) => $(element).html())
		.get()
		.find((text) => text?.includes('window.__PRELOADED_STATE__'));

	const assignIndex = scriptText.indexOf('window.__PRELOADED_STATE__');
	const braceStart = scriptText.indexOf('{', assignIndex);

	let braceCount = 0;
	let endIndex = -1;

	for (let i = braceStart; i < scriptText.length; i++) {
		if (scriptText[i] === '{') braceCount++;
		if (scriptText[i] === '}') braceCount--;

		if (braceCount === 0) {
			endIndex = i + 1;
			break;
		}
	}

	const jsonText = scriptText.slice(braceStart, endIndex);
	const jsonData = JSON.parse(jsonText);

	return jsonData;
}

module.exports = {
	getStockInfo,
};
