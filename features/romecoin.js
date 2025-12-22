const fs = require('fs');
const { DATABASE_CHANNEL_ID } = require('../constants');
const { checkAdmin } = require('../utils');
const { getData, updateData, migrateData } = require('./dataAccess');
const notionManager = require('./notion');

let romecoin_data = new Object();
let message_cooldown_users = new Array();
let reaction_cooldown_users = new Array();

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
    if (!interaction.isChatInputCommand()) return;

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