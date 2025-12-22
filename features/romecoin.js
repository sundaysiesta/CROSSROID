const fs = require('fs');
const { DATABASE_CHANNEL_ID } = require('../constants');
const { checkAdmin } = require('../utils');
const { getData, updateData, migrateData } = require('./dataAccess');
const notionManager = require('./notion');
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');

// ロメコインデータ
let romecoin_data = new Object();
// クールダウン用配列
let message_cooldown_users = new Array();
let reaction_cooldown_users = new Array();
// じゃんけん進行データ
let janken_progress_data = new Object();

async function clientReady(client) {
    // DBからデータを取得
    const db_channel = await client.channels.fetch(DATABASE_CHANNEL_ID);
    const message = (await db_channel.messages.fetch({ limit: 1, cache: false })).first();
    message.attachments.forEach(async (attachment) => {
        if (attachment.name === 'romecoin_data.json') {
            const response = await fetch(attachment.url);
            const data = await response.text();
            romecoin_data = JSON.parse(data);
        }
    });

    // 60秒ごとにデータを送信
    setInterval(async () => {
        fs.writeFile('./.tmp/romecoin_data.json', JSON.stringify(romecoin_data), (err) => {
            if (err) {
                throw err;
            }
        });

        await db_channel.send({files: ['./.tmp/romecoin_data.json']});
    }, 60000);

    // 10秒ごとにクールダウンをリセット
    setInterval(async () => {
        message_cooldown_users = new Array();
        reaction_cooldown_users = new Array();
    }, 10000);
}

async function interactionCreate(interaction) {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'romecoin') {
            const user = interaction.options.getUser('user') ? interaction.options.getUser('user').id : interaction.user.id;
            const romecoin = await getData(user, romecoin_data, 0);
            interaction.reply({ content: `<@${user}>の現在の所持ロメコイン: ${romecoin}`, ephemeral: true });
        }

        else if (interaction.commandName === 'romecoin_ranking') {
            // データを配列に変換（Notion名の場合はDiscord IDを取得）
            const sortedData = await Promise.all(Object.entries(romecoin_data).map(async ([key, value]) => {
                const isNotionName = !/^\d+$/.test(key);
                let discordId = key;
                
                if (isNotionName) {
                    discordId = await notionManager.getDiscordId(key) || key;
                }
                
                return { key, discordId, displayName: isNotionName ? key : null, value };
            }));
            
            sortedData.sort((a, b) => b.value - a.value);
            
            let content = '# ROMECOINランキング\n';
            for (let i = 0; i < Math.min(10, sortedData.length); i++) {
                const display = sortedData[i].displayName 
                    ? `${sortedData[i].displayName} (<@${sortedData[i].discordId}>)` 
                    : `<@${sortedData[i].discordId}>`;
                content += `${i + 1}位: ${display} - ${sortedData[i].value}\n`;
            }
            await interaction.reply({ content: content, ephemeral: true });
        }

        else if (interaction.commandName === 'janken') {
            if (!Object.values(janken_progress_data).some(data => (data.user && data.user.id === interaction.user.id) || (data.opponent && data.opponent.id === interaction.user.id))) {
                const opponent = interaction.options.getUser('opponent');
                if (await getData(interaction.user.id, romecoin_data, 0) >= 100) {
                    const progress_id =  crypto.randomUUID();
                    if (opponent) {
                        // クロスロイドと対戦
                        if (opponent.id === interaction.client.user.id) {
                            const hands = ['rock', 'scissors', 'paper'];
                            const opponentHand = hands[Math.floor(Math.random() * hands.length)];
                            // 手選択ボタンを表示
                            const rockButton = new ButtonBuilder().setCustomId(`janken_rock_${progress_id}`).setLabel('グー').setEmoji('✊').setStyle(ButtonStyle.Primary);
                            const scissorsButton = new ButtonBuilder().setCustomId(`janken_scissors_${progress_id}`).setLabel('チョキ').setEmoji('✌️').setStyle(ButtonStyle.Success);
                            const paperButton = new ButtonBuilder().setCustomId(`janken_paper_${progress_id}`).setLabel('パー').setEmoji('✋').setStyle(ButtonStyle.Danger);
                            const row = new ActionRowBuilder().addComponents(rockButton, scissorsButton, paperButton);
                            await interaction.reply({ content: `${interaction.user}が${opponent}にじゃんけん勝負を仕掛けた！\n出す手を選択してください`, components: [row]});
                            janken_progress_data[progress_id] = {user: interaction.user, opponent: opponent, timeout_id: null, user_hand: null, opponent_hand: opponentHand, status: 'selecting_hands'};
                        }
                        // 他ユーザーと対戦
                        else if (opponent.id !== interaction.user.id && !opponent.bot) {
                            if (await getData(opponent.id, romecoin_data, 0) >= 100) {
                                // 対戦相手の手選択ボタンを表示
                                const rockButton = new ButtonBuilder().setCustomId(`janken_rock_${progress_id}`).setLabel('グー').setEmoji('✊').setStyle(ButtonStyle.Primary);
                                const scissorsButton = new ButtonBuilder().setCustomId(`janken_scissors_${progress_id}`).setLabel('チョキ').setEmoji('✌️').setStyle(ButtonStyle.Success);
                                const paperButton = new ButtonBuilder().setCustomId(`janken_paper_${progress_id}`).setLabel('パー').setEmoji('✋').setStyle(ButtonStyle.Danger);
                                const row = new ActionRowBuilder().addComponents(rockButton, scissorsButton, paperButton);
                                const select_message = await interaction.reply({ content: `${interaction.user}が${opponent}にじゃんけん勝負を仕掛けた！\n出す手を選択してください`, components: [row]});
                                
                                // 60秒たっても選択されなかったら勝負破棄
                                const timeout_id = setTimeout(async () => {
                                    select_message.edit({ content: '時間切れとなったため、勝負は破棄されました', components: [] });
                                    await interaction.followUp({ content: '時間切れとなったため、勝負は破棄されました', flags: [MessageFlags.Ephemeral] });
                                    delete janken_progress_data[progress_id];
                                }, 60000);
                                janken_progress_data[progress_id] = {user: interaction.user, opponent: opponent, timeout_id: timeout_id, user_hand: null, opponent_hand: null, status: 'selecting_hands'};
                            } else {
                                await interaction.reply({ content: `対戦相手のロメコインが不足しています\n${opponent}の現在の所持ロメコイン: ${await getData(opponent.id, romecoin_data, 0)}\n必要なロメコイン: 100`, flags: [MessageFlags.Ephemeral] });
                            }
                        } else {
                            await interaction.reply({ content: '自分自身やクロスロイド以外のBotと対戦することはできません', flags: [MessageFlags.Ephemeral] });
                        }
                    }
                    // 対戦相手が指定されていない場合は対戦募集ボードを表示
                    else {
                        const acceptButton = new ButtonBuilder().setCustomId(`janken_accept_${progress_id}`).setLabel('受ける').setStyle(ButtonStyle.Success);
                        const row = new ActionRowBuilder().addComponents(acceptButton);
                        await interaction.reply({ content: `${interaction.user}がじゃんけんの対戦相手を募集しています！`, components: [row]});
                        const timeout_id = setTimeout(async () => {
                            await interaction.editReply({ content: '時間切れとなったため、対戦募集は終了しました', components: []});
                            delete janken_progress_data[progress_id];
                        }, 60000);
                        janken_progress_data[progress_id] = {user: interaction.user, opponent: null, timeout_id: timeout_id, user_hand: null, opponent_hand: null, status: 'waiting_for_opponent'};
                    }
                } else {
                    await interaction.reply({ content: `ロメコインが不足しています\n現在の所持ロメコイン: ${await getData(interaction.user.id, romecoin_data, 0)}\n必要なロメコイン: 100`, flags: [MessageFlags.Ephemeral] });
                }
            } else {
                await interaction.reply({ content: 'あなたは現在対戦中のため新規の対戦を開始できません', flags: [MessageFlags.Ephemeral] });
            }
        }
        else if (interaction.commandName === 'database_export') {
            if ((await checkAdmin(interaction.member))) {
                fs.writeFile('./.tmp/romecoin_data.json', JSON.stringify(romecoin_data), (err) => {
                    if (err) {
                        throw err;
                    }
                });

                await interaction.reply({files: ['./.tmp/romecoin_data.json'], ephemeral: true });
            }
        }
        else if (interaction.commandName === 'data_migrate') {
            if (!(await checkAdmin(interaction.member))) {
                return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
            }
            
            const targetUser = interaction.options.getUser('user');
            if (!targetUser) {
                return interaction.reply({ content: '❌ ユーザーを指定してください。', ephemeral: true });
            }
            
            const fs = require('fs');
            const path = require('path');
            const { migrateData } = require('./dataAccess');
            const persistence = require('./persistence');
            
            let migratedCount = 0;
            const results = [];
            
            // 各データファイルを引き継ぎ
            const files = [
                { file: 'duel_data.json', name: '決闘データ' },
                { file: 'romecoin_data.json', name: 'ロメコインデータ' },
                { file: 'activity_data.json', name: 'アクティビティデータ' },
                { file: 'custom_cooldowns.json', name: 'クールダウンデータ', prefix: 'battle_' }
            ];
            
            for (const { file, name, prefix = '' } of files) {
                const filePath = path.join(__dirname, '..', file);
                if (fs.existsSync(filePath)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        const migrated = await migrateData(targetUser.id, data, prefix);
                        if (migrated) {
                            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                            migratedCount++;
                            results.push(`✅ ${name}`);
                        } else {
                            results.push(`⏭️ ${name} (引き継ぎ不要)`);
                        }
                    } catch (e) {
                        results.push(`❌ ${name} (エラー: ${e.message})`);
                    }
                }
            }
            
            // Memory storeに保存
            await persistence.save(interaction.client).catch(() => {});
            
            const resultText = results.join('\n');
            await interaction.reply({ 
                content: `📊 **データ引き継ぎ結果**\n対象: <@${targetUser.id}>\n\n${resultText}\n\n引き継ぎ完了: ${migratedCount}件`, 
                ephemeral: true 
            });
        }
    }
    else if (interaction.isButton()) {
        // jankenボタンインタラクション処理(対戦承諾)
        if (interaction.customId.startsWith('janken_accept_')) {
            const progress_id = interaction.customId.split('_')[2];
            if (interaction.user.id !== janken_progress_data[progress_id].user.id && await getData(interaction.user.id, romecoin_data, 0) >= 100) {
                if (!Object.values(janken_progress_data).some(data => (data.user && data.user.id === interaction.user.id) || (data.opponent && data.opponent.id === interaction.user.id))) {
                    clearTimeout(janken_progress_data[progress_id].timeout_id);
                    const rockButton = new ButtonBuilder().setCustomId(`janken_rock_${progress_id}`).setLabel('グー').setEmoji('✊').setStyle(ButtonStyle.Primary);
                    const scissorsButton = new ButtonBuilder().setCustomId(`janken_scissors_${progress_id}`).setLabel('チョキ').setEmoji('✌️').setStyle(ButtonStyle.Success);
                    const paperButton = new ButtonBuilder().setCustomId(`janken_paper_${progress_id}`).setLabel('パー').setEmoji('✋').setStyle(ButtonStyle.Danger);
                    const row = new ActionRowBuilder().addComponents(rockButton, scissorsButton, paperButton);
                    await interaction.message.delete();
                    const select_message = await interaction.channel.send({ content: `${janken_progress_data[progress_id].user} 対戦相手が見つかりました！\n対戦相手は${interaction.user}です\n出す手を選択してください`, components: [row]});
                    janken_progress_data[progress_id].opponent = interaction.user;
                    janken_progress_data[progress_id].status = 'selecting_hands';
                    const timeout_id = setTimeout(async () => {
                        await select_message.edit({ content: '時間切れとなったため、勝負は破棄されました'});
                        delete janken_progress_data[progress_id];
                    }, 60000);
                    janken_progress_data[progress_id].timeout_id = timeout_id;
                } else {
                    await interaction.reply({ content: 'あなたは現在対戦中のため対戦ボードを承諾できません', flags: [MessageFlags.Ephemeral] });
                }
            } else {
                await interaction.reply({ content: '自分自身やロメコインが不足しているユーザーは対戦できません', flags: [MessageFlags.Ephemeral] });
            }
        }
        // jankenボタンインタラクション処理(手選択)
        else if (interaction.customId.startsWith('janken_')) {
            const progress_id = interaction.customId.split('_')[2];
            const progress = janken_progress_data[progress_id];
            // ユーザーの手選択処理
            if (interaction.user.id === progress.user.id) {
                progress.user_hand = interaction.customId.split('_')[1];
                await interaction.reply({ content: `あなたの手は${progress.user_hand}に決定しました。対戦相手の手を待っています...`, flags: [MessageFlags.Ephemeral] });
            }
            // 対戦相手の手選択処理
            else if (interaction.user.id === progress.opponent.id) {
                progress.opponent_hand = interaction.customId.split('_')[1];
                await interaction.reply({ content: `あなたの手は${progress.opponent_hand}に決定しました。対戦相手の手を待っています...`, flags: [MessageFlags.Ephemeral] });
            }
            // 勝敗判定
            if (progress.user_hand && progress.opponent_hand) {
                clearTimeout(progress.timeout_id);
                let result = '';
                if (progress.user_hand === progress.opponent_hand) {
                    result = '引き分け';
                } else if ((progress.user_hand === 'rock' && progress.opponent_hand === 'scissors') || (progress.user_hand === 'scissors' && progress.opponent_hand === 'paper') || (progress.user_hand === 'paper' && progress.opponent_hand === 'rock')) {
                    result = `${progress.user}の勝利！\n${progress.user}は100ロメコインを獲得し、${progress.opponent}は100ロメコインを失いました`;
                    await updateData(progress.user.id, romecoin_data, (current) => Math.round((current || 0) + 100));
                    await updateData(progress.opponent.id, romecoin_data, (current) => Math.round((current || 0) - 100));
                } else {
                    result = `${progress.opponent}の勝利！\n${progress.opponent}は100ロメコインを獲得し、${progress.user}は100ロメコインを失いました`;
                    await updateData(progress.user.id, romecoin_data, (current) => Math.round((current || 0) - 100));
                    await updateData(progress.opponent.id, romecoin_data, (current) => Math.round((current || 0) + 100));
                }
                await interaction.channel.send({ content: `# 対戦結果\n${progress.user}の手: ${progress.user_hand}\n${progress.opponent}の手: ${progress.opponent_hand}\n${result}`, components: [] });
                delete janken_progress_data[progress_id];
            }
        }
    }
}

async function messageCreate(message) {
    if (message.author.bot) return;
    if (message_cooldown_users.includes(message.author.id)) return;

    let score = 10;

    const generationRoles = [
        '1431905155938258988', // 第1世代
        '1431905155938258989', // 第2世代
        '1431905155938258990', // 第3世代
        '1431905155938258991', // 第4世代
        '1431905155938258992', // 第5世代
        '1431905155938258993', // 第6世代
        '1431905155938258994', // 第7世代
        '1431905155955294290', // 第8世代
        '1431905155955294291', // 第9世代
        '1431905155955294292', // 第10世代
        '1431905155955294293', // 第11世代
        '1431905155955294294', // 第12世代
        '1431905155955294295', // 第13世代
        '1431905155955294296', // 第14世代
        '1431905155955294297', // 第15世代
        '1431905155955294298', // 第16世代
        '1431905155955294299', // 第17世代
        '1431905155984392303', // 第18世代
        //'1433777496767074386' // 第19世代
    ]

    // 新規
    if (!message.member.roles.cache.some(role => generationRoles.includes(role.id))) {
        score *= 1.1;
    }

    // 直近10件のメッセージ中で会話している人の数
    let talkingMembers = [];
    (await message.channel.messages.fetch({ limit: 10 })).forEach(_message => {
        if (!_message.author.bot && _message.author.id !== message.author.id && !talkingMembers.includes(_message.author.id)) {
            talkingMembers.push(_message.author.id);
        }
    })
    score *= 1+talkingMembers.length/10;

    // 深夜
    if (message.createdAt.getHours() < 6) {
        score *= 1.5;
    }

    // データ引き継ぎ（ID → Notion名）
    await migrateData(message.author.id, romecoin_data);
    
    // ロメコインを更新
    await updateData(message.author.id, romecoin_data, (current) => {
        return Math.round((current || 0) + score);
    });

    // 返信先のユーザーにも付与
    if (message.reference) {
        const reference = await message.fetchReference();
        if (reference.guild.id === message.guild.id && !reference.author.bot && reference.author.id !== message.author.id) {
            // データ引き継ぎ（ID → Notion名）
            await migrateData(reference.author.id, romecoin_data);
            
            // ロメコインを更新
            await updateData(reference.author.id, romecoin_data, (current) => {
                return Math.round((current || 0) + 5);
            });
        }
    }

    message_cooldown_users.push(message.author.id);
}

async function messageReactionAdd(reaction, user) {
    if (user.bot || reaction.message.author.bot) return;
    if (reaction.message.author.id === user.id) return;
    if (reaction_cooldown_users.includes(user.id)) return;

    // データ引き継ぎ（ID → Notion名）
    await migrateData(reaction.message.author.id, romecoin_data);
    
    // メッセージがリアクションされたときにも付与
    await updateData(reaction.message.author.id, romecoin_data, (current) => {
        return Math.round((current || 0) + 5);
    });
    
    reaction_cooldown_users.push(user.id);
}

module.exports = {
    clientReady,
    interactionCreate,
    messageCreate,
    messageReactionAdd
};