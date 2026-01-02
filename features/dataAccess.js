const notionManager = require('./notion');

/**
 * データ保存用のキーを取得（常にDiscord IDを使用、文字化け防止のため）
 * @param {string} discordId - DiscordユーザーID
 * @returns {Promise<string>} 保存用キー（Discord ID）
 */
async function getDataKey(discordId) {
	// 常にDiscord IDを使用（Notion名は文字化けする可能性があるため）
	return discordId;
}

/**
 * データ読み込み用のキーを取得（Discord IDを優先、後方互換性のためNotion名も検索）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @returns {Promise<string|null>} 見つかったキー、存在しない場合はnull
 */
async function findDataKey(discordId, data) {
	// まずDiscord IDで検索（優先）
	if (data[discordId] !== undefined) {
		return discordId;
	}
	
	// 後方互換性のため、Notion名でも検索（既存データの移行用）
	const notionName = await notionManager.getNotionName(discordId);
	if (notionName) {
		// トリム済みのキーで検索
		const trimmedName = notionName.trim();
		if (data[trimmedName] !== undefined) {
			return trimmedName;
		}
		// スペース付きのキーで検索
		if (data[notionName] !== undefined) {
			return notionName;
		}
	}
	
	return null;
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
 * データを設定（常にDiscord IDで保存、文字化け防止のため）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {*} value - 設定する値
 * @returns {Promise<string>} 使用されたキー
 */
async function setData(discordId, data, value) {
	// まず移行を試みる（Notion名からDiscord IDへ）
	await migrateData(discordId, data);
	const key = await getDataKey(discordId); // 常にDiscord ID
	
	// 古いNotion名キーを削除（移行用）
	const notionName = await notionManager.getNotionName(discordId);
	if (notionName) {
		const trimmedNotionKey = notionName.trim();
		if (data[trimmedNotionKey] !== undefined && trimmedNotionKey !== key) {
			delete data[trimmedNotionKey];
		}
		if (data[notionName] !== undefined && notionName !== key) {
			delete data[notionName];
		}
	}
	
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
	// まず移行を試みる（Notion名からDiscord IDへ）
	await migrateData(discordId, data);
	const existingKey = await findDataKey(discordId, data);
	const existingValue = existingKey ? data[existingKey] : defaultValue;
	const newValue = updateFn(existingValue);

	// 常にDiscord IDで保存
	const newKey = await getDataKey(discordId); // 常にDiscord ID

	// キーが変わった場合（Notion名 → Discord IDへの移行）、古いキーを削除
	if (existingKey && existingKey !== newKey) {
		delete data[existingKey];
	}
	
	// 古いNotion名キーも削除（移行用）
	const notionName = await notionManager.getNotionName(discordId);
	if (notionName) {
		const trimmedNotionKey = notionName.trim();
		if (data[trimmedNotionKey] !== undefined && trimmedNotionKey !== newKey) {
			delete data[trimmedNotionKey];
		}
		if (data[notionName] !== undefined && notionName !== newKey) {
			delete data[notionName];
		}
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
 * Notion名ベースのデータをDiscord IDベースに引き継ぐ（文字化け防止のため）
 * @param {string} discordId - DiscordユーザーID
 * @param {Object} data - データオブジェクト
 * @param {string} prefix - キーのプレフィックス（オプション、例: "battle_"）
 * @returns {Promise<boolean>} 引き継ぎが成功したかどうか
 */
async function migrateData(discordId, data, prefix = '') {
	const notionName = await notionManager.getNotionName(discordId);
	const newKey = `${prefix}${discordId}`;
	
	// 既にDiscord IDでデータがある場合は引き継ぎ不要
	if (data[newKey] !== undefined) {
		return false;
	}

	// Notion名でデータがある場合はDiscord IDに移行
	if (notionName) {
		const notionKey = `${prefix}${notionName}`;
		const trimmedNotionKey = `${prefix}${notionName.trim()}`;
		
		// トリム済みのキーを優先
		if (data[trimmedNotionKey] !== undefined) {
			data[newKey] = data[trimmedNotionKey];
			delete data[trimmedNotionKey];
			return true;
		}
		// スペース付きのキーも確認
		if (data[notionKey] !== undefined) {
			data[newKey] = data[notionKey];
			delete data[notionKey];
			return true;
		}
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
	// まず移行を試みる（Notion名からDiscord IDへ）
	await migrateData(discordId, data, prefix);
	
	// Discord IDで検索（優先）
	const idKey = `${prefix}${discordId}`;
	if (data[idKey] !== undefined) {
		return data[idKey];
	}

	// 後方互換性のため、Notion名でも検索
	const notionName = await notionManager.getNotionName(discordId);
	if (notionName) {
		const trimmedNotionKey = `${prefix}${notionName.trim()}`;
		if (data[trimmedNotionKey] !== undefined) {
			return data[trimmedNotionKey];
		}
		const notionKey = `${prefix}${notionName}`;
		if (data[notionKey] !== undefined) {
			return data[notionKey];
		}
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
	// まず移行を試みる（Notion名からDiscord IDへ）
	await migrateData(discordId, data, prefix);
	const key = await getDataKey(discordId); // 常にDiscord ID
	const fullKey = `${prefix}${key}`;

	// 古いNotion名キーを削除（移行用）
	const notionName = await notionManager.getNotionName(discordId);
	if (notionName) {
		const trimmedNotionKey = `${prefix}${notionName.trim()}`;
		if (data[trimmedNotionKey] !== undefined && trimmedNotionKey !== fullKey) {
			delete data[trimmedNotionKey];
		}
		const notionKey = `${prefix}${notionName}`;
		if (data[notionKey] !== undefined && notionKey !== fullKey) {
			delete data[notionKey];
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
