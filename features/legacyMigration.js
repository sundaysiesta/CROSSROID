const { EmbedBuilder } = require('discord.js');

const warningCooldowns = new Set();
const GUIDANCE_MESSAGE = `
**旧Bot「名無しのロメダ民」は廃止されましたというよりあえて抑止してる**

今後は CROSSROID の \`/cronymous\` コマンドを使用してください。

`;

function setup(client) {
    client.on('messageCreate', async message => {
        try {
            // Webhookからのメッセージで、特定の名前で始まるかチェック
            if (message.webhookId && message.author.username.startsWith('名無しのロメダ民 ID:')) {

                // メッセージを削除
                await message.delete().catch(e => console.error('旧Botメッセージの削除に失敗:', e));

                const channelId = message.channel.id;

                // 警告メッセージの送信（クールダウン付き: 5分に1回）
                if (!warningCooldowns.has(channelId)) {
                    const embed = new EmbedBuilder()
                        .setTitle("匿名の弱体化でワッチョイが必須となるクロスロイドを使え")
                        .setDescription(GUIDANCE_MESSAGE)
                        .setColor(0xFF0000) // 赤
                        .setFooter({ text: 'CROSSROID System' });

                    const warningMsg = await message.channel.send({ embeds: [embed] });

                    warningCooldowns.add(channelId);
                    setTimeout(() => warningCooldowns.delete(channelId), 5 * 60 * 1000);

                    // 警告メッセージも30秒後に削除（ログを汚さないため）
                    setTimeout(() => {
                        warningMsg.delete().catch(() => { });
                    }, 30 * 1000);
                }
            }
        } catch (error) {
            console.error('レガシーマイグレーション機能でエラー:', error);
        }
    });
}

module.exports = { setup };
