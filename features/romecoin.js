const fs = require('fs');
const { DATABASE_CHANNEL_ID } = require('../constants');

let romecoin_data = new Object();

async function clientReady(client) {
    // DBからデータを取得
    const db_channel = await client.channels.fetch(DATABASE_CHANNEL_ID);

    message = (await db_channel.messages.fetch({ limit: 1, cache: false })).first();
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
    }, 30000);
}

async function interactionCreate(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === 'romecoin') {
        const user = interaction.optoions.getUser('user') ? interaction.options.getUser('user').id : interaction.user.id;
        const romecoin = romecoin_data[user] || 0;
        interaction.reply({ content: `<@${user}>の現在の所持ロメコイン: ${romecoin}`, ephemeral: true });
    }
}

async function messageCreate(message) {
    if (message.author.bot) return;

    let score = 10;

    const generationRoles = [
        '1431905155938258989', // 2
        '1431905155938258992', // 5
        '1431905155938258993', // 6
        '1431905155938258994', // 7
        '1431905155955294290', // 8
        '1431905155955294291', // 9
        '1431905155955294292', // 10
        '1431905155955294294', // 12
        '1431905155955294296', // 14
        '1431905155955294297', // 15
        '1431905155955294298', // 16
        '1431905155955294299', // 17
        '1431905155984392303', // 18
        // '1433777496767074386', // 19
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

    romecoin_data[message.author.id] = Math.round((romecoin_data[message.author.id] || 0) + score);

    // 返信先のユーザーにも付与
    if (message.reference) {
        const reference = await message.fetchReference();
        if (reference.guild.id === message.guild.id && !reference.author.bot && reference.author.id !== message.author.id) {
            romecoin_data[reference.author.id] = Math.round((romecoin_data[reference.author.id] || 0) + 5);
        }
    }
}

async function messageReactionAdd(reaction, user) {
    if (user.bot) return;
    if (reaction.message.author.bot) return;
    if (reaction.message.author.id === user.id) return;

    // メッセージがリアクションされたときにも付与
    romecoin_data[reaction.message.author.id] = Math.round((romecoin_data[reaction.message.author.id] || 0) + 5);
}

module.exports = {
    clientReady,
    interactionCreate,
    messageCreate,
    messageReactionAdd
};