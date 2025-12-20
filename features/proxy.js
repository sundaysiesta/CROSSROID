const {
    AUTO_PROXY_COOLDOWN_MS,
    WORD_PROXY_COOLDOWN_MS,
    ELITE_ROLE_ID
} = require('../constants');
const {
    isImageOrVideo,
    containsFilteredWords,
    hasForceProxyRole
} = require('../utils');

// 状態管理
const autoProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const wordProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const processingMessages = new Set();
const deletedMessageInfo = new Map(); // key: messageId, value: { content, author, attachments, channel }

function setup(client) {
    // 画像自動代行投稿機能
    client.on('messageCreate', async message => {
        if (message.author.bot || message.webhookId || message.system) return;
        // 自身のWebhookによる投稿を念のため除外
        if (message.author.username === 'CROSSROID Proxy') return;
        if (!message.attachments || message.attachments.size === 0) return;

        // 画像・動画ファイルがあるかチェック
        const hasMedia = Array.from(message.attachments.values()).some(attachment => isImageOrVideo(attachment));
        if (!hasMedia) return;

        const messageId = message.id;
        if (processingMessages.has(messageId)) return;

        processingMessages.add(messageId);
        console.log(`[画像代行] メッセージ ${messageId} の処理を開始`);

        try {
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!member) return;

            // クールダウンチェック（強制代行ロール保持者は無視）
            const hasForceProxy = hasForceProxyRole(member);
            if (!hasForceProxy) {
                const userId = message.author.id;
                const lastAutoProxyAt = autoProxyCooldowns.get(userId) || 0;
                const timeSinceLastProxy = Date.now() - lastAutoProxyAt;

                // 上級ロメダ民特典: クールダウン5秒に短縮 (通常15秒)
                const isElite = member.roles.cache.has(ELITE_ROLE_ID);
                const cooldown = isElite ? 5000 : AUTO_PROXY_COOLDOWN_MS;

                if (timeSinceLastProxy < cooldown) {
                    return;
                }
            }

            if (!message.guild.members.me.permissions.has('ManageMessages')) return;

            // 元のメッセージ情報を保存
            const originalContent = message.content || '';
            const originalAttachments = Array.from(message.attachments.values());
            const originalAuthor = message.author;
            // 上級ロメダ民は王冠付き
            let displayName = member?.nickname || originalAuthor.displayName;
            if (member.roles.cache.has(ELITE_ROLE_ID)) {
                displayName = `👑 ${displayName} 👑`;
            }

            // Webhookを取得または作成
            let webhook;
            try {
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.name === 'CROSSROID Proxy');

                if (!webhook) {
                    webhook = await message.channel.createWebhook({
                        name: 'CROSSROID Proxy',
                        avatar: originalAuthor.displayAvatarURL()
                    });
                }
            } catch (webhookError) {
                console.error(`[画像代行] Webhook取得/作成エラー:`, webhookError);
                throw webhookError;
            }

            const files = originalAttachments.map(attachment => ({
                attachment: attachment.url,
                name: attachment.name
            }));

            const deleteButton = {
                type: 2, // BUTTON
                style: 4, // DANGER
                label: '削除',
                custom_id: `delete_${originalAuthor.id}_${Date.now()}`,
                emoji: '🗑️'
            };

            const actionRow = {
                type: 1, // ACTION_ROW
                components: [deleteButton]
            };

            const sanitizedContent = originalContent
                .replace(/@everyone/g, '@\u200beveryone')
                .replace(/@here/g, '@\u200bhere')
                .replace(/<@&(\d+)>/g, '<@\u200b&$1>');

            // Webhookでメッセージを送信
            const webhookMessage = await webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                files: files,
                components: [actionRow],
                allowedMentions: { parse: [] }
            });

            // 削除情報を保存
            deletedMessageInfo.set(webhookMessage.id, {
                content: originalContent,
                author: originalAuthor,
                attachments: originalAttachments,
                channel: message.channel,
                originalMessageId: message.id,
                timestamp: Date.now()
            });

            autoProxyCooldowns.set(message.author.id, Date.now());

            // 元のメッセージを削除
            try {
                await message.delete();
            } catch (deleteError) {
                // Unknown Message (10008) は無視
                if (deleteError.code !== 10008) {
                    console.error(`[画像代行] 元のメッセージ削除エラー:`, deleteError);
                }
            }

        } catch (error) {
            console.error(`[画像代行] エラー:`, error);
        } finally {
            processingMessages.delete(messageId);
        }
    });

    // 特定ワード自動代行機能
    client.on('messageCreate', async message => {
        if (message.author.bot || message.webhookId || message.system) return;
        if (message.author.username === 'CROSSROID Word Filter') return;
        if (!message.content || message.content.trim() === '') return;

        if (!containsFilteredWords(message.content)) return;

        const userId = message.author.id;
        const lastWordProxyAt = wordProxyCooldowns.get(userId) || 0;
        if (Date.now() - lastWordProxyAt < WORD_PROXY_COOLDOWN_MS) return;

        if (processingMessages.has(message.id)) return;

        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!message.guild.members.me.permissions.has('ManageMessages')) return;

        processingMessages.add(message.id);

        try {
            const originalContent = message.content;
            const originalAuthor = message.author;
            const displayName = member?.nickname || originalAuthor.displayName;

            // Webhookを取得または作成
            let webhook;
            try {
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.name === 'CROSSROID Word Filter');

                if (!webhook) {
                    webhook = await message.channel.createWebhook({
                        name: 'CROSSROID Word Filter',
                        avatar: originalAuthor.displayAvatarURL()
                    });
                }
            } catch (webhookError) {
                throw webhookError;
            }

            const sanitizedContent = originalContent
                .replace(/@everyone/g, '@\u200beveryone')
                .replace(/@here/g, '@\u200bhere')
                .replace(/<@&(\d+)>/g, '<@\u200b&$1>');

            await webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                allowedMentions: { parse: [] }
            });

            wordProxyCooldowns.set(userId, Date.now());

            try {
                await message.delete();
            } catch (deleteError) {
                console.error('元のメッセージの削除に失敗しました:', deleteError);
            }

        } catch (error) {
            console.error('特定ワード自動代行でエラーが発生しました:', error.message);
        } finally {
            processingMessages.delete(message.id);
        }
    });

    // 定期的なクリーンアップ
    setInterval(() => {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const [userId, lastUsed] of autoProxyCooldowns.entries()) {
            if (lastUsed < oneHourAgo) autoProxyCooldowns.delete(userId);
        }
        for (const [userId, lastUsed] of wordProxyCooldowns.entries()) {
            if (lastUsed < oneHourAgo) wordProxyCooldowns.delete(userId);
        }
        for (const [messageId, info] of deletedMessageInfo.entries()) {
            if (Date.now() - (info.timestamp || 0) > oneHourAgo) deletedMessageInfo.delete(messageId);
        }

        // 古い処理中フラグのクリーンアップはSetなので難しいが、通常はfinallyで消える
    }, 30 * 60 * 1000);
}

module.exports = {
    setup,
    deletedMessageInfo // for imageLog to access
};
