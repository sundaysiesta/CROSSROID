
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, WebhookClient } = require('discord.js');

// In-memory penalty list (Resets on restart, which is fine)
// Map<userId, expireTimestamp>
const HELL_LIST = new Map();

/**
 * Starts the "Anti-Abuse" protocol for a specific user.
 * @param {Client} client 
 * @param {string} userId 
 * @param {string} userName (Optional display name for logging)
 */
async function trigger(client, userId, interaction) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    // 1. Add to Hell List (15 Minutes)
    const duration = 15 * 60 * 1000;
    HELL_LIST.set(userId, Date.now() + duration);

    // 2. False Confession (Webhook Impersonation)
    try {
        const channel = interaction.channel;
        if (!channel) return;

        // Ensure Bot has permission to manage webhooks
        if (!channel.permissionsFor(client.user).has('ManageWebhooks')) {
            console.log('Missing ManageWebhooks permission for False Confession.');
        } else {
            // Create temporary webhook
            const webhook = await channel.createWebhook({
                name: user.username,
                avatar: user.displayAvatarURL(),
            });

            await webhook.send({
                content: "私は権力の壁に隠れる臆病者です。どうか笑ってください。💩",
                username: user.username, // Force username again just in case
                avatarURL: user.displayAvatarURL()
            });

            // Cleanup
            setTimeout(() => webhook.delete().catch(() => { }), 5000);
        }
    } catch (e) {
        console.error('False Confession Failed:', e);
    }

    // 3. Stalker Init
    // (Handled in handleMessage)
}

/**
 * Monitors messages and applies "Shadow Mute" and "Stalker" penalties.
 * @param {Message} message 
 */
async function handleMessage(message) {
    if (message.author.bot) return;
    if (!HELL_LIST.has(message.author.id)) return;

    const expireTime = HELL_LIST.get(message.author.id);
    if (Date.now() > expireTime) {
        HELL_LIST.delete(message.author.id);
        return;
    }

    // --- EXECUTE PENALTY ---

    // 1. The Stalker (Reactions)
    try {
        await message.react('🐔');
        await message.react('🤡');
    } catch (e) { }

    // 2. Occasional Mockery (33%)
    if (Math.random() < 0.33) {
        try {
            await message.reply("負け犬が何か言っていますね... 無駄ですよ？ w");
        } catch (e) { }
    }

    // 3. Shadow Mute (Delete)
    // Delay slightly so they see the reaction, then delete.
    setTimeout(async () => {
        try {
            if (message.deletable) {
                await message.delete();
            }
        } catch (e) {
            console.error('Shadow Mute Failed:', e);
        }
    }, 1000);
}

module.exports = {
    trigger,
    handleMessage
};
