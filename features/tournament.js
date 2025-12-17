const { EmbedBuilder } = require('discord.js');
const crypto = require('crypto');
const { MAIN_CHANNEL_ID, CURRENT_GENERATION_ROLE_ID } = require('../constants');
const ActivityTracker = require('./activityTracker');
const NotionManager = require('./notion');

class TournamentManager {
    constructor() {
        this.seriesLocks = new Set();
    }

    async start(interaction, config) {
        // Prevent double click on same interaction?
        // Interaction reply usually handles this, but logic here takes time.
        // Assuming interaction is unique enough or user behaves.

        await interaction.editReply({ content: '🏆 選手権モードの準備中... 参加者を収集中です。' });

        const guild = interaction.guild;

        // --- 0. Pre-fetch Notion Data (Name Resolution) ---
        await interaction.editReply({ content: '📚 Notionデータベースから名簿を取得しています...' });
        const notionMap = await NotionManager.getNameMap();

        // --- 1. Activity Ranking (Current Month) ---
        await interaction.editReply({ content: '📊 メインチャンネルの活動状況(今月)を取得しています...' });

        // Use 'month' mode for strictly this month's activity
        const ranking = ActivityTracker.getUserRanking('month');

        // --- 2. Filter & Resolve Names ---
        const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
        const allMembers = await guild.members.fetch();
        const seenNames = new Set();

        const eligibleCandidates = [];

        for (const { userId, count } of ranking) {
            // Cutoff: Minimum 5 messages
            if (count < 5) continue;

            const member = allMembers.get(userId);
            if (!member) continue;

            // Check Generation Role
            const hasGenRole = member.roles.cache.some(r => romanRegex.test(r.name));
            const hasCurrentGen = member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

            if (hasGenRole || hasCurrentGen) {
                // NAME RESOLUTION: Notion > DisplayName
                const notionName = notionMap.get(member.id);
                const finalName = notionName || member.displayName;

                // Deduplication Logic
                if (seenNames.has(finalName)) {
                    console.log(`[Tournament] Duplicate Removed: ${finalName} (ID: ${member.id}, HighRankUser kept)`);
                    continue;
                }
                seenNames.add(finalName);

                eligibleCandidates.push({
                    name: finalName,
                    userId: member.id,
                    emoji: null,
                    messageCount: count
                });
            }
        }

        // Limit to Top 80
        const TOP_N = 80;
        const participants = eligibleCandidates.slice(0, TOP_N);

        if (participants.length < 4) {
            return interaction.followUp({ content: '❌ 参加条件を満たすメンバーが見つかりませんでした (4名未満)。\n・データ集計中(初回起動後5分)\n・または発言不足\n・世代ロール欠如', ephemeral: true });
        }

        // Shuffle
        participants.sort(() => 0.5 - Math.random());

        // Split into 4 Houses
        const houses = ['Griffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin'];
        const groups = {
            'Griffindor': [],
            'Hufflepuff': [],
            'Ravenclaw': [],
            'Slytherin': []
        };

        participants.forEach((p, i) => {
            const house = houses[i % 4];
            groups[house].push(p);
        });

        // Generate Series ID
        const seriesId = crypto.randomUUID();
        const PollManager = require('./poll');

        // Generate Group Image
        const PollVisualizer = require('./pollVisualizer');
        try {
            const groupImage = await PollVisualizer.generateGroupAssignmentImage(groups, config.title);
            await interaction.followUp({ content: '## 📋 予選グループ分け発表', files: [{ attachment: groupImage, name: 'groups.png' }] });
        } catch (e) {
            console.error('Group Image failed:', e);
        }

        // Create Qualifiers
        for (const house of houses) {
            const groupCandidates = groups[house];
            if (groupCandidates.length === 0) continue;

            console.log(`[Tournament] Config Check for ${house}: qualifierDuration=${config.qualifierDuration} (${typeof config.qualifierDuration}), duration=${config.duration}`);

            const pollConfig = {
                ...config,
                title: `${config.title} - 予選ブロック: ${house}`,
                candidates: groupCandidates,
                mode: 'multi',
                duration: config.qualifierDuration || config.duration,
                maxVotes: config.qualifierMaxVotes || config.maxVotes || 3,
                startDate: config.qualifierStart || config.startDate,
                seriesId: seriesId,
                stage: 'qualifier',
                house: house
            };

            try {
                await PollManager.createPollInternal(interaction.channel, pollConfig, interaction.user.id);
            } catch (e) {
                console.error(`Failed to create poll for ${house}:`, e);
            }
        }

        await interaction.followUp({ content: '✅ 予選ブロックを作成しました！' });
    }

    async checkSeriesCompletion(seriesId, client) {
        if (this.seriesLocks.has(seriesId)) return;
        this.seriesLocks.add(seriesId);

        const PollManager = require('./poll');

        try {
            // 1. Check Qualifiers -> Finals
            const seriesPolls = Array.from(PollManager.polls.values()).filter(p => p.config.seriesId === seriesId && p.config.stage === 'qualifier');

            if (seriesPolls.length > 0) {
                const allEnded = seriesPolls.every(p => p.ended);
                if (allEnded) {
                    // Check if finals already created
                    const existingFinal = Array.from(PollManager.polls.values()).find(p => p.config.seriesId === seriesId && p.config.stage === 'final');
                    if (!existingFinal) {
                        // Aggregate Winners
                        const winners = [];
                        const PollVisualizer = require('./pollVisualizer');
                        const passerImages = [];

                        for (const poll of seriesPolls) {
                            // Calculate winner
                            const tally = {};
                            poll.config.candidates.forEach(c => tally[c.id] = 0);
                            Object.values(poll.votes).forEach(voteList => {
                                voteList.forEach(candId => tally[candId]++);
                            });

                            // Sort
                            const sorted = [...poll.config.candidates].sort((a, b) => tally[b.id] - tally[a.id]);
                            if (sorted.length > 0) {
                                // Select Top 3
                                const topCandidates = sorted.slice(0, 3);

                                // Generate Passer Image for this House
                                try {
                                    const house = poll.config.house;
                                    // Need to fetch avatars if missing
                                    await Promise.all(topCandidates.map(async c => {
                                        if (c.userId && !c.avatarURL) {
                                            const ch = await client.channels.fetch(poll.channelId).catch(() => null);
                                            if (ch) {
                                                const m = await ch.guild.members.fetch(c.userId).catch(() => null);
                                                if (m) c.avatarURL = m.displayAvatarURL({ extension: 'png' });
                                            }
                                        }
                                    }));

                                    const buffer = await PollVisualizer.generateQualifierPasserImage(topCandidates, house, poll.config.title);
                                    passerImages.push({ attachment: buffer, name: `passers_${house}.png` });

                                } catch (e) {
                                    console.error(`Failed to gen passer image for ${poll.config.house}:`, e);
                                }

                                topCandidates.forEach((winner, index) => {
                                    winner.name = `Rank${index + 1} ${winner.name} (${poll.config.house})`;
                                    winners.push(winner);
                                });
                            }
                        }

                        // Post Passer Images
                        const channel = await client.channels.fetch(seriesPolls[0].channelId).catch(() => null);
                        if (channel && passerImages.length > 0) {
                            await channel.send({ content: '## ⚡ 決勝進出者決定！', files: passerImages });
                        }

                        if (winners.length > 0) {
                            // Create Finals
                            // Use Series Config inheritance if available, else defaults
                            const parentConfig = seriesPolls[0].config;

                            const finalConfig = {
                                title: `${parentConfig.title.split('-')[0].trim()} - 決勝戦`,
                                candidates: winners,
                                mode: parentConfig.finalMaxVotes > 1 ? 'multi' : 'single',
                                maxVotes: parentConfig.finalMaxVotes || 1,
                                duration: parentConfig.finalDuration || (24 * 60 * 60 * 1000), // Default 24h
                                startDate: parentConfig.finalStart, // Schedule if set
                                seriesId: seriesId,
                                stage: 'final',
                                roles: parentConfig.roles || [],
                                accountAgeLimit: parentConfig.accountAgeLimit || 0,
                                allowSelfVote: parentConfig.allowSelfVote !== undefined ? parentConfig.allowSelfVote : true
                            };

                            // Post to same channel as first qualifier
                            if (channel) {
                                await channel.send('# 🏆 予選終了！ 決勝戦開始！');
                                await PollManager.createPollInternal(channel, finalConfig, seriesPolls[0].authorId);
                            }
                        }
                    }
                }
            }

            // 2. Check Finals -> Victory Ceremony
            const finalPoll = Array.from(PollManager.polls.values()).find(p => p.config.seriesId === seriesId && p.config.stage === 'final');
            if (finalPoll && finalPoll.ended && !finalPoll.ceremonyDone) {
                finalPoll.ceremonyDone = true;
                PollManager.save(); // Persist ceremony state

                // Determine Winners (Rank 1-3)
                const tally = {};
                finalPoll.config.candidates.forEach(c => tally[c.id] = 0);
                Object.values(finalPoll.votes).forEach(voteList => {
                    voteList.forEach(candId => tally[candId]++);
                });
                const sorted = [...finalPoll.config.candidates].sort((a, b) => tally[b.id] - tally[a.id]);
                const top3 = sorted.slice(0, 3);

                const channel = await client.channels.fetch(finalPoll.channelId).catch(() => null);
                if (channel) {
                    await channel.send('# 👑 優勝者決定！ おめでとうございます！');

                    // Generate Images
                    const PollVisualizer = require('./pollVisualizer');
                    const files = [];

                    // Render Rank 1, 2, 3 (Victory Images)
                    for (let i = 0; i < top3.length; i++) {
                        const candidate = top3[i];
                        // Fetch Avatar
                        if (candidate.userId && !candidate.avatarURL) {
                            const member = await channel.guild.members.fetch(candidate.userId).catch(() => null);
                            if (member) candidate.avatarURL = member.displayAvatarURL({ extension: 'png' });
                        }

                        try {
                            const buffer = await PollVisualizer.generateVictoryImage(candidate, i + 1);
                            files.push({ attachment: buffer, name: `victory_rank${i + 1}.png` });
                        } catch (e) {
                            console.error('Victory Image Gen Failed:', e);
                        }
                    }

                    // --- GENERATE ALL RANKING BOARD ---
                    try {
                        // Prepare data with votes for all candidates
                        const rankingData = sorted.map((c, idx) => ({
                            ...c,
                            votes: tally[c.id] || 0,
                            rank: idx + 1
                        }));

                        // Ensure avatars for ALL (or at least top 12)
                        await Promise.all(rankingData.map(async c => {
                            if (c.userId && !c.avatarURL) {
                                const m = await channel.guild.members.fetch(c.userId).catch(() => null);
                                if (m) c.avatarURL = m.displayAvatarURL({ extension: 'png' });
                            }
                        }));

                        const rankBuffer = await PollVisualizer.generateFinalRankingImage(rankingData, finalPoll.config.title);
                        files.push({ attachment: rankBuffer, name: 'ranking_overview.png' });
                    } catch (e) {
                        console.error('Final Ranking Image Gen Failed:', e);
                    }

                    // Send all images
                    if (files.length > 0) {
                        await channel.send({ content: `## 🏆 表彰台 & 最終結果`, files: files });

                        // User Request: Prompt for improvements
                        await channel.send('### 📈 選手権お疲れ様ダラァ！');
                    }
                }
            }
        } finally {
            this.seriesLocks.delete(seriesId);
        }
    }
}

module.exports = new TournamentManager();
