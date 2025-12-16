const { logError } = require('../utils');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = "15499b1436df801e8ef0cc98d897bc80"

class NotionManager {
    constructor() {
        this.cache = new Map();
        this.lastFetch = 0;
        this.CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    }

    async getNameMap() {
        // Return cache if fresh
        if (Date.now() - this.lastFetch < this.CACHE_TTL && this.cache.size > 0) {
            return this.cache;
        }

        if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
            console.warn('[NotionManager] Missing API Key or DB ID.');
            return new Map();
        }

        console.log('[NotionManager] Fetching data from Notion...');
        const map = new Map();
        let cursor = undefined;

        try {
            do {
                const response = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${NOTION_API_KEY}`,
                        'Notion-Version': '2022-06-28',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        start_cursor: cursor,
                        page_size: 100,
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Notion API Error: ${response.status} ${errText}`);
                }

                const data = await response.json();

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

                    if (name && discordId) {
                        // Normalize ID (remove spaces/dashes just in case)
                        discordId = discordId.replace(/\D/g, '');
                        if (discordId.length > 10) { // Basic validity check
                            map.set(discordId, name);
                        }
                    }
                }

                cursor = data.next_cursor;

            } while (cursor);

            console.log(`[NotionManager] Fetched ${map.size} users.`);
            this.cache = map;
            this.lastFetch = Date.now();
            return map;

        } catch (e) {
            console.error('[NotionManager] Failed to fetch:', e);
            return new Map();
        }
    }
}

module.exports = new NotionManager();
