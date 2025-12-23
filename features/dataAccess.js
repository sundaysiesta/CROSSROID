const notionManager = require('./notion');

/**
 * データ保存用のキーを取得（Notion名があればNotion名、なければDiscord ID）
 * @param {string} discordId - DiscordユーザーID
 * @returns {Promise<string>} 保存用キー（Notion名またはDiscord ID）
 */
async function getDataKey(discordId) {
	return await notionManager.getDataKey(discordId);
}

/**
 * データ読み込み用のキーを取得（Notion名とDiscord IDの両方をチェック）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @returns {Promise<string|null>} 見つかったキー、存在しない場合はnull
 */
async function findDataKey(discordId, data) {
	return await notionManager.findDataKey(discordId, data);
}

/**
 * データを取得（Notion名とDiscord IDの両方をチェック）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {*} defaultValue - デフォルト値
 * @returns {Promise<*>} データ値
 */
async function getData(discordId, data, defaultValue = null) {
	// まず移行を試みる
	await migrateData(discordId, data);
	const key = await findDataKey(discordId, data);
	return key ? data[key] : defaultValue;
}

/**
 * データを設定（Notion名があればNotion名、なければDiscord IDで保存）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {*} value - 設定する値
 * @returns {Promise<string>} 使用されたキー
 */
async function setData(discordId, data, value) {
	// まず移行を試みる
	await migrateData(discordId, data);
	const key = await getDataKey(discordId);
	data[key] = value;
	return key;
}

/**
 * データを更新（既存のデータがあれば更新、なければ新規作成）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {Function} updateFn - 更新関数（既存値を受け取り、新しい値を返す）
 * @param {*} defaultValue - デフォルト値（既存データがない場合）
 * @returns {Promise<string>} 使用されたキー
 */
async function updateData(discordId, data, updateFn, defaultValue = null) {
	// まず移行を試みる
	await migrateData(discordId, data);
	const existingKey = await findDataKey(discordId, data);
	const existingValue = existingKey ? data[existingKey] : defaultValue;
	const newValue = updateFn(existingValue);

	// Notion名があればNotion名で保存、なければDiscord IDで保存
	const newKey = await getDataKey(discordId);

	// キーが変わった場合（ID → Notion名への移行）、古いキーを削除
	if (existingKey && existingKey !== newKey) {
		delete data[existingKey];
	}

	data[newKey] = newValue;
	return newKey;
}

/**
 * データを削除（Notion名とDiscord IDの両方をチェック）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @returns {Promise<boolean>} 削除されたかどうか
 */
async function deleteData(discordId, data) {
	const key = await findDataKey(discordId, data);
	if (key) {
		delete data[key];
		return true;
	}
	return false;
}

/**
 * Discord IDベースのデータをNotion名ベースに引き継ぐ
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {string} prefix - キーのプレフィックス（オプション、例: "battle_"）
 * @returns {Promise<boolean>} 引き継ぎが成功したかどうか
 */
async function migrateData(discordId, data, prefix = '') {
	const notionName = await notionManager.getNotionName(discordId);
	if (!notionName) {
		return false; // Notionに登録されていない
	}

	const oldKey = `${prefix}${discordId}`;
	const newKey = `${prefix}${notionName}`;

	// 既にNotion名でデータがある場合は引き継ぎ不要
	if (data[newKey]) {
		return false;
	}

	// Discord IDでデータがある場合は引き継ぎ
	if (data[oldKey]) {
		data[newKey] = data[oldKey];
		delete data[oldKey];
		return true;
	}

	return false;
}

/**
 * プレフィックス付きキーでデータを取得
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {string} prefix - キーのプレフィックス（例: "battle_"）
 * @param {*} defaultValue - デフォルト値
 * @returns {Promise<*>} データ値
 */
async function getDataWithPrefix(discordId, data, prefix, defaultValue = null) {
	// まず移行を試みる
	await migrateData(discordId, data, prefix);
	const notionName = await notionManager.getNotionName(discordId);

	// まずNotion名で検索
	if (notionName) {
		const notionKey = `${prefix}${notionName}`;
		if (data[notionKey] !== undefined) {
			return data[notionKey];
		}
	}

	// Notion名が見つからない、またはデータが存在しない場合はDiscord IDで検索
	const idKey = `${prefix}${discordId}`;
	if (data[idKey] !== undefined) {
		return data[idKey];
	}

	return defaultValue;
}

/**
 * プレフィックス付きキーでデータを設定
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {string} prefix - キーのプレフィックス（例: "battle_"）
 * @param {*} value - 設定する値
 * @returns {Promise<string>} 使用されたキー
 */
async function setDataWithPrefix(discordId, data, prefix, value) {
	// まず移行を試みる
	await migrateData(discordId, data, prefix);
	const key = await getDataKey(discordId);
	const fullKey = `${prefix}${key}`;

	// 古いキーを削除（ID → Notion名への移行時）
	const notionName = await notionManager.getNotionName(discordId);
	if (notionName && key === notionName) {
		const oldKey = `${prefix}${discordId}`;
		if (data[oldKey] !== undefined && oldKey !== fullKey) {
			delete data[oldKey];
		}
	}

	data[fullKey] = value;
	return fullKey;
}

/**
 * キーからDiscord IDを取得（Notion名の場合は逆引き、そうでなければそのまま返す）
 * @param {string} key - Notion名またはDiscord ID
 * @returns {Promise<string|null>} Discord ID、見つからない場合はnull
 */
async function getDiscordIdFromKey(key) {
	return await notionManager.getDiscordIdFromKey(key);
}

module.exports = {
	getDataKey,
	findDataKey,
	getData,
	setData,
	updateData,
	deleteData,
	migrateData,
	getDataWithPrefix,
	setDataWithPrefix,
	getDiscordIdFromKey,
};
