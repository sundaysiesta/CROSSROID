const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = "15499b1436df801e8ef0cc98d897bc80"

class NotionManager {
    constructor() {
        this.cache = new Map(); // Discord ID -> Notion名
        this.reverseCache = new Map(); // Notion名 -> Discord ID
        this.discordIdToNotionNameMap = new Map(); // Discord ID -> Notion名（逆引き用）
        this.notionNameToDiscordIdMap = new Map(); // Notion名 -> Discord ID（逆引き用）
        this.lastFetch = 0;
        this.CACHE_TTL = 10 * 60 * 1000; // 10 minutes
        this.fetchingPromise = null; // 同時実行を防ぐためのPromise
    }

    async getNameMap() {
        // Return cache if fresh
        if (Date.now() - this.lastFetch < this.CACHE_TTL && this.cache.size > 0) {
            return this.cache;
        }

        // 既にfetch中の場合、そのPromiseを待つ
        if (this.fetchingPromise) {
            console.log('[NotionManager] Already fetching, waiting for existing fetch...');
            return await this.fetchingPromise;
        }

        if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
            console.warn('[NotionManager] Missing API Key or DB ID.');
            return new Map();
        }

        // fetchを開始し、Promiseを保存
        this.fetchingPromise = this._doFetch();
        
        try {
            const result = await this.fetchingPromise;
            return result;
        } finally {
            this.fetchingPromise = null; // 完了したらクリア
        }
    }

    async _doFetch() {
        console.log('[NotionManager] Fetching data from Notion...');
        const map = new Map(); // Discord ID -> Notion名
        const reverseMap = new Map(); // Notion名 -> Discord ID
        let cursor = undefined;
        let pageCount = 0;
        let totalFetched = 0;

        try {
            do {
                // DiscordユーザーIDが入力されているデータのみを取得するフィルター
                // フィールド名を動的に検出するため、まずはフィルターなしで取得し、後でフィルタリング
                const requestBody = {
                    page_size: 100,
                };
                
                if (cursor) {
                    requestBody.start_cursor = cursor;
                }

                const response = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${NOTION_API_KEY}`,
                        'Notion-Version': '2022-06-28',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    // レート制限エラーの場合
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('retry-after') || '3';
                        console.log(`[NotionManager] Rate limit reached. Waiting ${retryAfter} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
                        continue; // リトライ
                    }
                    throw new Error(`Notion API Error: ${response.status} ${errText}`);
                }

                const data = await response.json();
                pageCount++;
                totalFetched += data.results.length;
                console.log(`[NotionManager] Fetched page ${pageCount}: ${data.results.length} items (Total: ${totalFetched})`);

                for (const page of data.results) {
                    const props = page.properties;
                    let name = null;
                    let discordId = null;

                    // 1. Find Name (Title)
                    // Japanese: "名前", English: "Name"
                    const nameProp = props['名前'] || props['Name'] || Object.values(props).find(p => p.type === 'title');

                    if (nameProp && nameProp.title && nameProp.title.length > 0) {
                        name = nameProp.title[0].plain_text;
                    }

                    // 2. Find Discord ID (Rich Text)
                    // Japanese: "DiscordユーザーID"
                    const idProp = props['DiscordユーザーID'] || props['Discord User ID'] || props['DiscordID'];

                    if (idProp) {
                        if (idProp.type === 'rich_text' && idProp.rich_text.length > 0) {
                            discordId = idProp.rich_text[0].plain_text.trim();
                        } else if (idProp.type === 'number') {
                            discordId = String(idProp.number);
                        } else if (idProp.type === 'phone_number') {
                            discordId = idProp.phone_number;
                        }
                    }

                    // Discord IDが入力されているデータのみを処理
                    if (name && discordId) {
                        // Normalize ID (remove spaces/dashes just in case)
                        discordId = discordId.replace(/\D/g, '');
                        if (discordId.length > 10) { // Basic validity check
                            map.set(discordId, name);
                            reverseMap.set(name, discordId);
                        }
                    }
                }

                cursor = data.next_cursor;
                
                // レート制限を回避するため、リクエスト間に少し待機
                if (cursor) {
                    await new Promise(resolve => setTimeout(resolve, 200)); // 200ms待機
                }

                // デバッグ用: next_cursorの状態をログ出力
                if (cursor) {
                    console.log(`[NotionManager] Next cursor exists, continuing pagination...`);
                } else {
                    console.log(`[NotionManager] No more pages (next_cursor is null/undefined)`);
                }

            } while (cursor);

            console.log(`[NotionManager] ✅ Fetch complete: ${map.size} valid users from ${pageCount} pages (Total items fetched: ${totalFetched}, Filtered: ${totalFetched - map.size} items without Discord ID)`);
            this.cache = map;
            this.reverseCache = reverseMap;
            // 逆引き用のマップも更新
            this.discordIdToNotionNameMap = new Map(map);
            this.notionNameToDiscordIdMap = new Map(reverseMap);
            this.lastFetch = Date.now();
            return map;

        } catch (e) {
            console.error('[NotionManager] Failed to fetch:', e);
            return new Map();
        }
    }

    /**
     * Discord IDからNotion名を取得
     * @param {string} discordId - DiscordユーザーID
     * @returns {Promise<string|null>} Notion名、存在しない場合はnull
     */
    async getNotionName(discordId) {
        const map = await this.getNameMap();
        return map.get(discordId) || null;
    }

    /**
     * Notion名からDiscord IDを取得
     * @param {string} notionName - Notion名
     * @returns {Promise<string|null>} Discord ID、存在しない場合はnull
     */
    async getDiscordId(notionName) {
        await this.getNameMap();
        return this.reverseCache.get(notionName) || this.notionNameToDiscordIdMap.get(notionName) || null;
    }

    /**
     * Discord IDからNotion名を取得（getNotionNameのエイリアス）
     * @param {string} discordId - DiscordユーザーID
     * @returns {Promise<string|null>} Notion名、存在しない場合はnull
     */
    async getName(discordId) {
        return await this.getNotionName(discordId);
    }

    /**
     * キーがNotion名かどうかを判定
     * @param {string} key - チェックするキー
     * @returns {Promise<boolean>} Notion名の場合はtrue、そうでなければfalse
     */
    async isNotionName(key) {
        await this.getNameMap();
        return this.notionNameToDiscordIdMap.has(key);
    }

    /**
     * キーからDiscord IDを取得（Notion名の場合は逆引き、そうでなければそのまま返す）
     * @param {string} key - Notion名またはDiscord ID
     * @returns {Promise<string|null>} Discord ID、見つからない場合はnull
     */
    async getDiscordIdFromKey(key) {
        if (await this.isNotionName(key)) {
            return await this.getDiscordId(key);
        }
        // 既にDiscord IDの場合はそのまま返す
        return key;
    }

    /**
     * データ保存用のキーを取得（Notion名があればNotion名、なければDiscord ID）
     * @param {string} discordId - DiscordユーザーID
     * @returns {Promise<string>} 保存用キー（Notion名またはDiscord ID）
     */
    async getDataKey(discordId) {
        const notionName = await this.getNotionName(discordId);
        return notionName || discordId;
    }

    /**
     * データ読み込み用のキーを取得（Notion名とDiscord IDの両方をチェック）
     * @param {string} discordId - DiscordユーザーID
     * @param {Object} data - データオブジェクト
     * @returns {Promise<string|null>} 見つかったキー、存在しない場合はnull
     */
    async findDataKey(discordId, data) {
        // まずNotion名で検索
        const notionName = await this.getNotionName(discordId);
        if (notionName && data[notionName]) {
            return notionName;
        }
        // Notion名が見つからない、またはデータが存在しない場合はDiscord IDで検索
        if (data[discordId]) {
            return discordId;
        }
        return null;
    }
}

module.exports = new NotionManager();
