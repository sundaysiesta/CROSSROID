const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

const POLL_DATA_FILE = path.join(__dirname, '../poll_data.json');
const POLL_STORAGE_DIR = path.join(__dirname, '../poll_storage');

// --- Helper: Time Parser (24h -> ms) ---
function parseDuration(str) {
    if (!str) return 24 * 60 * 60 * 1000; // default 24h
    const match = str.match(/(\d+)(h|m|d|s)/);
    if (!match) return 24 * 60 * 60 * 1000;
    const val = parseInt(match[1]);
    const unit = match[2];
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
}

// --- Helper: Date Parser ---
// --- Helper: Date Parser ---
function parseDate(str) {
    if (!str) return null;

    // Normalize: Replace space with T if missing, assume JST if no offset
    let formatted = str.trim();
    if (formatted.match(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/)) {
        formatted = formatted.replace(' ', 'T') + ':00+09:00';
    } else if (formatted.match(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/)) {
        formatted = formatted.replace(' ', 'T') + '+09:00';
    }

    let date = new Date(formatted);
    // Fallback for simple string if regex didn't catch it
    if (isNaN(date.getTime())) {
        date = new Date(str); // Attempt raw
    }

    if (!isNaN(date.getTime())) {
        console.log(`[PollParser] Date Parsed: "${str}" -> ${formatted} -> ${date.toLocaleString()} (${date.getTime()})`);
        return date.getTime();
    }
    console.warn(`[PollParser] Invalid Date detected: "${str}"`);
    return null;
}

class PollParser {
    static parse(text) {
        const lines = text.split(/\r?\n/);
        const config = {
            title: 'No Title',
            duration: 24 * 60 * 60 * 1000,
            startDate: null,
            mode: 'multi',
            maxVotes: 0,
            public: true,
            accountAgeLimit: 0,
            allowSelfVote: false,
            candidates: [],
            roles: []
        };

        let section = 'meta';

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;

            if (line === '[設定]' || line === '[Settings]') {
                section = 'settings';
                continue;
            }
            if (line === '[候補者]' || line === '[Candidates]') {
                section = 'candidates';
                continue;
            }

            if (section === 'meta') {
                const parts = line.split(':');
                if (parts.length < 2) continue;
                const key = parts[0].trim();
                const val = parts.slice(1).join(':').trim();

                if (key === 'タイトル' || key === 'Title') config.title = val;
                if (key === '終了' || key === 'End') config.duration = parseDuration(val);
                if (key === '開始' || key === 'Start') config.startDate = parseDate(val);

                if (key === '予選期間' || key === 'QualifierDuration') config.qualifierDuration = parseDuration(val);
                if (key === '決勝期間' || key === 'FinalDuration') config.finalDuration = parseDuration(val);
                if (key === '予選開始' || key === 'QualifierStart') config.qualifierStart = parseDate(val);
                if (key === '決勝開始' || key === '本番開始' || key === 'FinalStart') config.finalStart = parseDate(val);
            } else if (section === 'settings') {
                const parts = line.split(':');
                if (parts.length < 2) continue;
                const key = parts[0].trim();
                const val = parts.slice(1).join(':').trim();

                if (key === '投票モード') {
                    if (val.includes('単一')) config.mode = 'single';
                    if (val.includes('選手権') || val.includes('Championship')) config.mode = 'championship';
                }
                if (key === '一人あたりの票数' || key === 'MaxVotes') {
                    const limit = parseInt(val);
                    if (!isNaN(limit)) config.maxVotes = limit;
                }
                if (key === '予選票数' || key === 'QualifierMaxVotes') {
                    const limit = parseInt(val);
                    if (!isNaN(limit)) config.qualifierMaxVotes = limit;
                }
                if (key === '決勝票数' || key === 'FinalMaxVotes') {
                    const limit = parseInt(val);
                    if (!isNaN(limit)) config.finalMaxVotes = limit;
                }

                // Allow Duration/Start in Settings section too
                if (key === '予選期間' || key === 'QualifierDuration') config.qualifierDuration = parseDuration(val);
                if (key === '決勝期間' || key === 'FinalDuration') config.finalDuration = parseDuration(val);
                if (key === '予選開始' || key === 'QualifierStart') config.qualifierStart = parseDate(val);
                if (key === '決勝開始' || key === '本番開始' || key === 'FinalStart') config.finalStart = parseDate(val);

                if (key === '公開設定' || key === 'Public') {
                    if (val.includes('ブラインド') || val.includes('非公開') || val.includes('完全非公開')) config.public = false;
                }
                if (key === 'アカウント制限') {
                    const days = parseInt(val);
                    if (!isNaN(days)) config.accountAgeLimit = days;
                }
                if (key === '自己投票') {
                    if (val.includes('許可')) config.allowSelfVote = true;
                }
                if (key === '参加資格') {
                    const ids = val.match(/\d{17,19}/g);
                    if (ids) {
                        config.roles.push(...ids);
                    }
                }
            } else if (section === 'candidates') {
                // CSV: Name, Emoji
                const parts = line.split(',');
                const name = parts[0].trim();
                const emoji = parts[1] ? parts[1].trim() : null;
                if (name) {
                    const mentionMatch = name.match(/<@!?(\d+)>/);
                    const userId = mentionMatch ? mentionMatch[1] : null;
                    config.candidates.push({ name, emoji, userId });
                }
            }
        }
        return config;
    }
}

class PollManager {
    constructor() {
        // this.polls is REMOVED. Data is on disk.
        // We keep active timers in memory.
        this.activeTimers = new Map();

        // Ensure storage exists
        if (!fs.existsSync(POLL_STORAGE_DIR)) {
            fs.mkdirSync(POLL_STORAGE_DIR, { recursive: true });
        }

        this.initStorage();
    }

    initStorage() {
        this.migrateLegacyData();
        console.log(`[PollManager] Storage initialized at ${POLL_STORAGE_DIR}`);
    }

    migrateLegacyData() {
        if (fs.existsSync(POLL_DATA_FILE)) {
            try {
                console.log('[PollManager] Migrating legacy poll_data.json...');
                const data = JSON.parse(fs.readFileSync(POLL_DATA_FILE, 'utf8'));
                let count = 0;
                for (const [id, poll] of Object.entries(data)) {
                    this.savePoll(poll);
                    count++;
                }
                // Rename legacy file to avoid re-migration
                fs.renameSync(POLL_DATA_FILE, POLL_DATA_FILE + '.bak');
                console.log(`[PollManager] Migration Complete: Split ${count} polls.`);
            } catch (e) {
                console.error('[PollManager] Migration Failed:', e);
            }
        }
    }

    // --- File Accessors ---

    getPoll(id) {
        if (!id) return null;
        const p = path.join(POLL_STORAGE_DIR, `${id}.json`);
        if (fs.existsSync(p)) {
            try {
                return JSON.parse(fs.readFileSync(p, 'utf8'));
            } catch (e) {
                console.error(`[PollManager] Failed to read poll ${id}:`, e);
                return null;
            }
        }
        return null;
    }

    savePoll(poll) {
        if (!poll || !poll.id) return;
        const p = path.join(POLL_STORAGE_DIR, `${poll.id}.json`);
        try {
            fs.writeFileSync(p, JSON.stringify(poll, null, 2));
        } catch (e) {
            console.error(`[PollManager] Failed to save poll ${poll.id}:`, e);
        }
    }

    // For TournamentManager (Scanning)
    getAllPolls() {
        const polls = [];
        try {
            const files = fs.readdirSync(POLL_STORAGE_DIR).filter(f => f.endsWith('.json'));
            for (const f of files) {
                const p = path.join(POLL_STORAGE_DIR, f);
                try {
                    polls.push(JSON.parse(fs.readFileSync(p, 'utf8')));
                } catch (e) { }
            }
        } catch (e) {
            console.error('[PollManager] Directory Scan Failed:', e);
        }
        return polls;
    }

    // save() is DEPRECATED in new architecture (individual saves happen via savePoll)
    save() {
        // No-op
    }

    _saveInternal() {
        // No-op
    }

    async createPoll(interaction, textConfig) {
        const config = PollParser.parse(textConfig);

        // Check for Championship Mode
        if (config.mode === 'championship') {
            const TournamentManager = require('./tournament');
            return await TournamentManager.start(interaction, config);
        }

        if (config.candidates.length < 2) return interaction.editReply('エラー: 候補者は最低2人必要です。');

        const pollState = await this.createPollInternal(interaction.channel, config, interaction.user.id);

        let replyMsg = '✅ 投票を作成しました。';
        if (pollState.startsAt > Date.now()) {
            replyMsg += `\n開始日時: <t:${Math.floor(pollState.startsAt / 1000)}:f>`;
        }
        await interaction.editReply({ content: replyMsg });
    }

    async createPollInternal(channel, config, authorId) {
        const pollId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5); // Unique ID
        const defaultEmojis = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴', '🇵', '🇶', '🇷', '🇸', '🇹', '🇺', '🇻', '🇼', '🇽', '🇾', '🇿'];
        config.candidates.forEach((c, i) => {
            if (!c.emoji) c.emoji = defaultEmojis[i % defaultEmojis.length];
            c.id = `c${i}`;
        });

        // Set effective start date
        const now = Date.now();
        const effectiveStart = config.startDate && config.startDate > now ? config.startDate : now;

        const pollState = {
            id: pollId,
            config: config,
            votes: {},
            createdAt: now,
            startsAt: effectiveStart,
            authorId: authorId,
            channelId: channel.id,
            messageId: null,
            started: effectiveStart <= now, // Init status
            ended: false,
            processing: false // Lock flag
        };

        console.log(`[PollManager] Created Poll ${pollId}: Starts=${new Date(pollState.startsAt).toLocaleString()} (${pollState.startsAt}), Duration=${pollState.config.duration}ms, Ends=${new Date(pollState.startsAt + pollState.config.duration).toLocaleString()}`);

        const embed = this.generateEmbed(pollState);
        const components = this.generateComponents(pollState);

        const msg = await channel.send({ embeds: [embed], components: components });
        pollState.messageId = msg.id;

        // this.polls.set(pollId, pollState); -> REMOVED
        // this.save(); -> REMOVED
        this.savePoll(pollState); // Direct File Save

        // Activate Scheduler for this poll
        this.schedulePollEvents(pollState);

        return pollState;
    }

    generateEmbed(poll, forceReveal = false) {
        // ... (Unchanged)
        const { config, votes, ended, startsAt } = poll;
        const totalVotes = Object.keys(votes).length;
        const now = Date.now();
        const isStarted = now >= startsAt;

        const tally = {};
        config.candidates.forEach(c => tally[c.id] = 0);
        Object.values(votes).forEach(voteList => {
            voteList.forEach(candId => {
                if (tally[candId] !== undefined) tally[candId]++;
            });
        });

        const statusColor = ended ? 0x999999 : (isStarted ? 0x00BFFF : 0xFFA500);
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${config.title}`)
            .setColor(statusColor)
            .setTimestamp(poll.createdAt)
            .setFooter({ text: `Poll ID: ${poll.id} | Mode: ${config.mode}` });

        const showResults = forceReveal || (config.public && ended && isStarted);

        if (showResults) {
            let desc = '';
            const sortedCands = [...config.candidates];
            sortedCands.sort((a, b) => tally[b.id] - tally[a.id]);

            sortedCands.forEach((c, index) => {
                const count = tally[c.id];
                const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                const barLength = Math.round(percentage / 10);
                const bar = '▓'.repeat(barLength) + '░'.repeat(10 - barLength);

                let rank = '';
                if (index === 0) rank = '🥇 ';
                else if (index === 1) rank = '🥈 ';
                else if (index === 2) rank = '🥉 ';
                else rank = `${index + 1}. `;

                desc += `${rank} ${c.emoji} **${c.name}**: ${count}票 (${percentage.toFixed(1)}%)\n\`${bar}\`\n`;
            });
            embed.setDescription(desc);
        } else {
            let desc = '';
            if (!isStarted) {
                desc = `⛔ **投票開始待機中**\n開始時刻までお待ちください。\n\n`;
            } else if (ended) {
                desc = '投票は終了しました。結果発表をお待ちください。\n\n';
            } else {
                desc = '投票受付中... (結果は非公開です)\n\n';
            }

            config.candidates.forEach(c => {
                desc += `${c.emoji} **${c.name}**\n`;
            });
            embed.setDescription(desc);
        }

        embed.addFields({ name: 'Total Votes', value: totalVotes.toString(), inline: true });

        if (!isStarted) {
            embed.addFields({ name: 'Starts', value: `<t:${Math.floor(startsAt / 1000)}:F>`, inline: true });
        } else if (!ended) {
            const endsAt = startsAt + config.duration;
            embed.addFields({ name: 'Ends', value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true });
        }

        return embed;
    }

    generateComponents(poll) {
        if (poll.ended) return [];
        const { config, id, startsAt } = poll;
        const now = Date.now();
        const isStarted = now >= startsAt;
        const components = [];
        const disabled = !isStarted;

        if (config.candidates.length <= 20) {
            let row = new ActionRowBuilder();
            config.candidates.forEach((c, index) => {
                if (index > 0 && index % 5 === 0) {
                    components.push(row);
                    row = new ActionRowBuilder();
                }
                const btn = new ButtonBuilder()
                    .setCustomId(`poll_vote_${id}_${c.id}`)
                    .setLabel(c.name.substring(0, 80))
                    .setEmoji(c.emoji)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled);
                row.addComponents(btn);
            });
            components.push(row);
        } else {
            const chunkSize = 25;
            for (let i = 0; i < config.candidates.length; i += chunkSize) {
                const chunk = config.candidates.slice(i, i + chunkSize);
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`poll_select_${id}_${i}`)
                    .setPlaceholder(disabled ? '開始待機中...' : `候補者を選択 ${i + 1}〜${i + chunk.length}`)
                    .setMinValues(1)
                    .setMaxValues(config.mode === 'single' ? 1 : chunk.length)
                    .setDisabled(disabled)
                    .addOptions(chunk.map(c => ({
                        label: c.name.substring(0, 100),
                        value: c.id,
                        emoji: c.emoji
                    })));
                components.push(new ActionRowBuilder().addComponents(menu));
            }
        }
        return components;
    }

    async handleInteraction(client, interaction) {
        try {
            const parts = interaction.customId.split('_');
            const pollId = parts[2];
            // CHANGE: Direct Read
            const poll = this.getPoll(pollId);

            if (!poll) return interaction.reply({ content: 'この投票は終了しているか、存在しません。', ephemeral: true });
            if (Date.now() < poll.startsAt) {
                return interaction.reply({ content: `⏳ 投票はまだ開始されていません。\n開始時刻: <t:${Math.floor(poll.startsAt / 1000)}:R>`, ephemeral: true });
            }

            const member = interaction.member;

            if (poll.config.accountAgeLimit > 0) {
                const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
                if (ageDays < poll.config.accountAgeLimit) {
                    return interaction.reply({ content: `⛔ アカウント作成から${poll.config.accountAgeLimit}日経過していないため投票できません。`, ephemeral: true });
                }
            }

            if ((poll.config.roles || []).length > 0) {
                const hasRole = member.roles.cache.some(r => poll.config.roles.includes(r.id));
                if (!hasRole) return interaction.reply({ content: '⛔ 投票権限がありません。', ephemeral: true });
            }

            if (!poll.config.allowSelfVote) {
                const targetIds = [];
                if (interaction.isButton()) targetIds.push(parts[3]);
                if (interaction.isStringSelectMenu()) targetIds.push(...interaction.values);

                const targetNames = targetIds.map(tid => poll.config.candidates.find(c => c.id === tid)?.name);
                const myName = member.displayName;
                const myUser = member.user.username;

                if (targetNames.some(n => n === myName || n === myUser)) {
                    return interaction.reply({ content: '⛔ 自己投票は禁止されています。', ephemeral: true });
                }
            }

            let votedCands = [];
            if (interaction.isButton()) {
                const candId = parts[3];
                votedCands = [candId];
            } else if (interaction.isStringSelectMenu()) {
                votedCands = interaction.values;
            }

            let currentVotes = poll.votes[interaction.user.id] || [];
            if (poll.config.mode === 'single') {
                poll.votes[interaction.user.id] = votedCands;
            } else {
                if (interaction.isButton()) {
                    const cid = votedCands[0];
                    if (currentVotes.includes(cid)) {
                        poll.votes[interaction.user.id] = currentVotes.filter(id => id !== cid);
                    } else {
                        if (poll.config.maxVotes > 0 && currentVotes.length >= poll.config.maxVotes) {
                            return interaction.reply({ content: `⛔ 一人あたり最大 ${poll.config.maxVotes}票 までです。`, ephemeral: true });
                        }
                        poll.votes[interaction.user.id] = [...currentVotes, cid];
                    }
                } else {
                    if (poll.config.maxVotes > 0 && votedCands.length > poll.config.maxVotes) {
                        return interaction.reply({ content: `⛔ 選択数が多すぎます。最大 ${poll.config.maxVotes}票 までです。`, ephemeral: true });
                    }
                    poll.votes[interaction.user.id] = votedCands;
                }
            }

            votedCands = poll.votes[interaction.user.id] || [];

            // CHANGE: Direct Write
            this.savePoll(poll);

            const votedNames = votedCands.map(cid => {
                const c = poll.config.candidates.find(cand => cand.id === cid);
                return c ? `${c.emoji || ''} ${c.name}` : 'Unknown';
            }).join(', ');

            await interaction.reply({ content: `🗳️ 投票を確認しました:\n**${votedNames || '選択解除'}**`, ephemeral: true }).catch(() => { });

            const msg = await interaction.channel.messages.fetch(poll.messageId).catch(() => null);
            if (msg) {
                // Background update, don't block
                msg.edit({ embeds: [this.generateEmbed(poll)], components: this.generateComponents(poll) }).catch(() => { });
            }
        } catch (error) {
            // Silence "Unknown Interaction" (10062) which happens on timeout/race
            if (error.code === 10062 || error.message.includes('Unknown interaction')) {
                return;
            }
            console.error('Vote Interaction Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `❌ エラーが発生しました: ${error.message}`, ephemeral: true }).catch(() => { });
            } else {
                await interaction.followUp({ content: `❌ エラーが発生しました: ${error.message}`, ephemeral: true }).catch(() => { });
            }
        }
    }

    async showStatus(interaction, pollId) {
        // CHANGE: Direct Read
        const poll = this.getPoll(pollId);
        if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });

        const embed = this.generateEmbed(poll, true);
        embed.setTitle(`🕵️ [Admin Peek] ${poll.config.title}`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async publishResult(interaction, pollId) {
        // CHANGE: Direct Read
        const poll = this.getPoll(pollId);
        if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });

        if (poll.processing) return interaction.reply({ content: '⚠️ 現在集計処理中です。しばらくお待ちください。', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        await this._executePublish(poll, interaction.channel);
        await interaction.editReply({ content: '✅ 結果を公開しました。' });
    }

    async _executePublish(poll, channel) {
        if (poll.processing || poll.ended) return; // Dual check
        poll.processing = true;

        // Critical Fix: Mark as ended immediately
        poll.ended = true;
        // CHANGE: Direct Write
        this.savePoll(poll);

        console.log(`[PollManager] Publishing results for ${poll.id}...`);

        try {
            const embed = this.generateEmbed(poll, true);
            embed.setTitle(`🏆 結果発表: ${poll.config.title}`);
            embed.setImage('attachment://ranking.png');

            const PollVisualizer = require('./pollVisualizer');
            let files = [];
            try {
                const enrichedPoll = { ...poll };
                enrichedPoll.config = { ...poll.config };

                // Bulk Fetch Optimization
                const userIds = poll.config.candidates.map(c => c.userId).filter(id => id);
                let members = new Map();
                if (userIds.length > 0) {
                    try {
                        members = await channel.guild.members.fetch({ user: userIds });
                    } catch (e) {
                        console.error('Bulk Fetch Failed in _executePublish:', e);
                    }
                }

                const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
                const currentGenRoleId = require('../constants').CURRENT_GENERATION_ROLE_ID;

                enrichedPoll.config.candidates = poll.config.candidates.map(c => {
                    const enriched = { ...c };
                    if (c.userId && members.has(c.userId)) {
                        const member = members.get(c.userId);
                        enriched.avatarURL = member.displayAvatarURL({ extension: 'png', size: 256 });

                        // Gen Role Logic
                        let genRole = member.roles.cache.find(r => romanRegex.test(r.name));
                        if (!genRole && currentGenRoleId) genRole = member.roles.cache.get(currentGenRoleId);
                        if (genRole) {
                            enriched.generation = genRole.name.toUpperCase();
                            enriched.generationColor = genRole.hexColor;
                        }
                    }
                    return enriched;
                });

                const imageBuffer = await PollVisualizer.generateRankingImage(enrichedPoll);
                files = [{ attachment: imageBuffer, name: 'ranking.png' }];
            } catch (e) {
                console.error('Failed to generate ranking image:', e);
                embed.setFooter({ text: '画像生成に失敗しました' });
            }

            await channel.send({ content: '## ⚡ 投票結果発表！', embeds: [embed], files: files });

            const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
            if (msg) await msg.edit({ components: [] });

        } catch (e) {
            console.error('Publish Execution Failed:', e);
        } finally {
            poll.processing = false; // Always release lock
            this.save();

            // Critical: Always check for progression, even if messsage failed
            if (poll.config.seriesId) {
                const TournamentManager = require('./tournament');
                // Run in background to not block finally
                TournamentManager.checkSeriesCompletion(poll.config.seriesId, channel.client).catch(err => console.error('Series Check Failed:', err));
            }
        }
    }

    // --- Scheduler System (Precise, not 1-min interval) ---

    schedulePollEvents(poll) {
        if (poll.ended || poll.processing) return;

        const now = Date.now();
        const duration = poll.config.duration;
        const endsAt = poll.startsAt + duration;

        // 1. Check Start Logic
        if (!poll.started) {
            if (now < poll.startsAt) {
                // Future Start
                const delay = poll.startsAt - now;
                if (delay > 2147483647) return; // Ignore too far future
                setTimeout(() => this.activatePoll(poll.id), delay);
                console.log(`[PollScheduler] Scheduled Start for ${poll.id} in ${Math.ceil(delay / 1000)}s`);
            } else {
                // Catch up
                this.activatePoll(poll.id);
            }
        }

        // 2. Check End Logic
        // Calculate delay until end
        const effectiveEnd = endsAt;
        if (now < effectiveEnd) {
            const delay = effectiveEnd - now;
            if (delay > 2147483647) return;
            setTimeout(() => this.endPoll(poll.id), delay);
            console.log(`[PollScheduler] Scheduled End for ${poll.id} in ${Math.ceil(delay / 1000)}s`);
        } else {
            // Overdue
            this.endPoll(poll.id);
        }
    }

    async activatePoll(pollId) {
        // CHANGE: Direct Read
        const poll = this.getPoll(pollId);
        if (!poll || poll.started || poll.ended) return;

        console.log(`[PollManager] Activating poll ${poll.id}`);
        poll.started = true;
        // CHANGE: Direct Write
        this.savePoll(poll);

        try {
            if (this.client) {
                const channel = await this.client.channels.fetch(poll.channelId).catch(() => null);
                if (channel) {
                    const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
                    if (msg) {
                        await msg.edit({ embeds: [this.generateEmbed(poll)], components: this.generateComponents(poll) });
                    }
                }
            }
        } catch (e) {
            console.error(`Activation UI Update Failed for ${poll.id}:`, e);
        }
    }

    async endPoll(pollId) {
        // CHANGE: Direct Read
        const poll = this.getPoll(pollId);
        if (!poll || poll.ended || poll.processing) return;

        console.log(`[PollManager] Ending poll ${poll.id}`);

        try {
            if (this.client) {
                const channel = await this.client.channels.fetch(poll.channelId).catch(() => null);
                if (channel) {
                    await this._executePublish(poll, channel);
                } else {
                    poll.ended = true;
                    // CHANGE: Direct Write
                    this.savePoll(poll);
                }
            }
        } catch (e) {
            console.error(`End Poll Failed for ${poll.id}:`, e);
        }
    }

    init(client) {
        this.client = client;
        console.log('[PollManager] Scheduler Initialized. Scanning active polls...');

        // CHANGE: Scan directory instead of memory map
        const allPolls = this.getAllPolls();
        console.log(`[PollManager] Found ${allPolls.length} total polls in storage.`);

        for (const poll of allPolls) {
            this.schedulePollEvents(poll);
        }
    }

    startTicker(client) {
        this.init(client);
    }

    async previewPoll(interaction, count = 5) {
        await interaction.deferReply({ ephemeral: true });

        const emojis = ['🍎', '🍊', '🍇', '🍓', '🍌', '🍉', '🥝', '🍒', '🍑', '🍍', '🍈', '🍋', '🍐', '🥭'];
        const names = ['Sample Candidate A', 'Dr. Mario', 'Super Long Name User Who Has Too Many Titles', 'The Underrated', 'Newcomer', 'Legendary Hero', 'Villain'];

        const candidates = [];
        for (let i = 0; i < count; i++) {
            candidates.push({
                id: `mock${i}`,
                name: names[i % names.length] + (i > 6 ? ` ${i}` : ''),
                emoji: emojis[i % emojis.length],
                avatarURL: null,
                generation: Math.random() > 0.5 ? (Math.random() > 0.5 ? 'XVI' : 'VII') : null
            });
        }

        const config = {
            title: '【Preview】 人気投票選手権',
            mode: 'multi',
            candidates: candidates
        };

        const votes = {};
        const totalVotes = 100 + Math.floor(Math.random() * 500);

        for (let v = 0; v < totalVotes; v++) {
            let targetIndex = 0;
            const r = Math.random();
            if (r < 0.3) targetIndex = 0;
            else if (r < 0.5) targetIndex = 1;
            else if (r < 0.65) targetIndex = 2;
            else targetIndex = Math.floor(Math.random() * count);

            const uid = `voter_${v}`;
            votes[uid] = [candidates[targetIndex].id];
        }

        const mockPoll = {
            config: config,
            votes: votes
        };

        const PollVisualizer = require('./pollVisualizer');
        try {
            const imageBuffer = await PollVisualizer.generateRankingImage(mockPoll);
            await interaction.editReply({
                content: '✅ **Design Preview Generated**\n実際のデザインを確認してください。',
                files: [{ attachment: imageBuffer, name: 'preview.png' }]
            });
        } catch (e) {
            await interaction.editReply({ content: 'Preview Gen Failed: ' + e.message });
        }
    }
}

module.exports = new PollManager();
