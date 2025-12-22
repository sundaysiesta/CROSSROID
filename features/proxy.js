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
const sentWebhookMessages = new Set(); // 送信済みの元メッセージIDを追跡（重複防止）

// ログ用ヘルパー関数
function logWebhookAction(action, messageId, details = {}) {
    const timestamp = new Date().toISOString();
    const detailStr = Object.keys(details).length > 0 
        ? ` | ${JSON.stringify(details)}` 
        : '';
    console.log(`[WEBHOOK-${action}] ${timestamp} | MessageID: ${messageId}${detailStr}`);
}

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
        
        // ロック機構: 既に処理中の場合は即座にreturn（競合状態を防ぐ）
        if (processingMessages.has(messageId)) {
            logWebhookAction('SKIP-DUPLICATE', messageId, { reason: 'Already processing' });
            return;
        }
        
        // ロックを取得（先にaddすることで、他の処理が開始されないようにする）
        processingMessages.add(messageId);
        logWebhookAction('START', messageId, { 
            author: message.author.id, 
            channel: message.channel.id,
            attachmentCount: message.attachments.size 
        });

        let shouldProcess = true;
        try {
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!member) {
                logWebhookAction('SKIP', messageId, { reason: 'Member not found' });
                shouldProcess = false;
                return;
            }

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
                    logWebhookAction('SKIP', messageId, { reason: 'Cooldown', remaining: cooldown - timeSinceLastProxy });
                    shouldProcess = false;
                    return;
                }
            }

            if (!message.guild.members.me.permissions.has('ManageMessages')) {
                logWebhookAction('SKIP', messageId, { reason: 'Missing ManageMessages permission' });
                shouldProcess = false;
                return;
            }

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
                logWebhookAction('FETCH-WEBHOOK', messageId, { channel: message.channel.id });
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.name === 'CROSSROID Proxy');

                if (!webhook) {
                    logWebhookAction('CREATE-WEBHOOK', messageId, { channel: message.channel.id });
                    webhook = await message.channel.createWebhook({
                        name: 'CROSSROID Proxy',
                        avatar: originalAuthor.displayAvatarURL()
                    });
                    logWebhookAction('WEBHOOK-CREATED', messageId, { webhookId: webhook.id });
                } else {
                    logWebhookAction('WEBHOOK-FOUND', messageId, { webhookId: webhook.id });
                }
            } catch (webhookError) {
                logWebhookAction('ERROR', messageId, { 
                    stage: 'webhook-fetch-create', 
                    error: webhookError.message 
                });
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

            // Webhookでメッセージを送信（重複防止の最終チェック）
            // 送信直前に再度チェック：既に送信済みまたは処理中の場合はスキップ
            if (sentWebhookMessages.has(messageId)) {
                logWebhookAction('SKIP-ALREADY-SENT', messageId, { 
                    reason: 'Already sent webhook for this message' 
                });
                return;
            }
            
            // メッセージがまだ存在するか確認（削除済みの場合はスキップ）
            try {
                await message.fetch();
            } catch (fetchError) {
                if (fetchError.code === 10008) { // Unknown Message
                    logWebhookAction('SKIP-MESSAGE-DELETED', messageId, { 
                        reason: 'Original message already deleted' 
                    });
                    return;
                }
                // その他のエラーは続行
            }
            
            logWebhookAction('SEND-START', messageId, { 
                webhookId: webhook.id, 
                fileCount: files.length,
                contentLength: sanitizedContent.length 
            });
            
            // 送信前にマーク（重複送信を防ぐ）
            sentWebhookMessages.add(messageId);
            
            const webhookMessage = await webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                files: files,
                components: [actionRow],
                allowedMentions: { parse: [] }
            }).catch(async (sendError) => {
                // 送信エラー時はマークを解除
                sentWebhookMessages.delete(messageId);
                throw sendError;
            });

            logWebhookAction('SEND-SUCCESS', messageId, { 
                webhookMessageId: webhookMessage.id,
                webhookId: webhook.id 
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
                logWebhookAction('DELETE-ORIGINAL', messageId, { success: true });
            } catch (deleteError) {
                // Unknown Message (10008) は無視
                if (deleteError.code !== 10008) {
                    logWebhookAction('DELETE-ERROR', messageId, { 
                        error: deleteError.message,
                        code: deleteError.code 
                    });
                    console.error(`[画像代行] 元のメッセージ削除エラー:`, deleteError);
                } else {
                    logWebhookAction('DELETE-SKIP', messageId, { reason: 'Message already deleted (10008)' });
                }
            }

            logWebhookAction('COMPLETE', messageId, { 
                webhookMessageId: webhookMessage.id 
            });

        } catch (error) {
            logWebhookAction('ERROR', messageId, { 
                error: error.message,
                stack: error.stack?.split('\n')[0] 
            });
            console.error(`[画像代行] エラー:`, error);
        } finally {
            // 確実にロックを解除（早期リターン時も含む）
            if (processingMessages.has(messageId)) {
                processingMessages.delete(messageId);
                logWebhookAction('UNLOCK', messageId, { 
                    processed: shouldProcess !== false 
                });
            }
        }
    });

    // 特定ワード自動代行機能
    client.on('messageCreate', async message => {
        if (message.author.bot || message.webhookId || message.system) return;
        if (message.author.username === 'CROSSROID Word Filter') return;
        if (!message.content || message.content.trim() === '') return;

        if (!containsFilteredWords(message.content)) return;

        const messageId = message.id;
        const userId = message.author.id;
        const lastWordProxyAt = wordProxyCooldowns.get(userId) || 0;
        if (Date.now() - lastWordProxyAt < WORD_PROXY_COOLDOWN_MS) return;

        // ロック機構: 既に処理中の場合は即座にreturn
        if (processingMessages.has(messageId)) {
            logWebhookAction('SKIP-DUPLICATE', messageId, { 
                type: 'word-filter',
                reason: 'Already processing' 
            });
            return;
        }

        // ロックを取得
        processingMessages.add(messageId);
        logWebhookAction('START', messageId, { 
            type: 'word-filter',
            author: userId,
            channel: message.channel.id 
        });

        let shouldProcess = true;
        try {
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!message.guild.members.me.permissions.has('ManageMessages')) {
                logWebhookAction('SKIP', messageId, { 
                    type: 'word-filter',
                    reason: 'Missing ManageMessages permission' 
                });
                shouldProcess = false;
                return;
            }

            const originalContent = message.content;
            const originalAuthor = message.author;
            const displayName = member?.nickname || originalAuthor.displayName;

            // Webhookを取得または作成
            let webhook;
            try {
                logWebhookAction('FETCH-WEBHOOK', messageId, { 
                    type: 'word-filter',
                    channel: message.channel.id 
                });
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.name === 'CROSSROID Word Filter');

                if (!webhook) {
                    logWebhookAction('CREATE-WEBHOOK', messageId, { 
                        type: 'word-filter',
                        channel: message.channel.id 
                    });
                    webhook = await message.channel.createWebhook({
                        name: 'CROSSROID Word Filter',
                        avatar: originalAuthor.displayAvatarURL()
                    });
                    logWebhookAction('WEBHOOK-CREATED', messageId, { 
                        type: 'word-filter',
                        webhookId: webhook.id 
                    });
                } else {
                    logWebhookAction('WEBHOOK-FOUND', messageId, { 
                        type: 'word-filter',
                        webhookId: webhook.id 
                    });
                }
            } catch (webhookError) {
                logWebhookAction('ERROR', messageId, { 
                    type: 'word-filter',
                    stage: 'webhook-fetch-create',
                    error: webhookError.message 
                });
                throw webhookError;
            }

            const sanitizedContent = originalContent
                .replace(/@everyone/g, '@\u200beveryone')
                .replace(/@here/g, '@\u200bhere')
                .replace(/<@&(\d+)>/g, '<@\u200b&$1>');

            logWebhookAction('SEND-START', messageId, { 
                type: 'word-filter',
                webhookId: webhook.id,
                contentLength: sanitizedContent.length 
            });

            await webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                allowedMentions: { parse: [] }
            });

            logWebhookAction('SEND-SUCCESS', messageId, { 
                type: 'word-filter',
                webhookId: webhook.id 
            });

            wordProxyCooldowns.set(userId, Date.now());

            try {
                await message.delete();
                logWebhookAction('DELETE-ORIGINAL', messageId, { 
                    type: 'word-filter',
                    success: true 
                });
            } catch (deleteError) {
                if (deleteError.code !== 10008) {
                    logWebhookAction('DELETE-ERROR', messageId, { 
                        type: 'word-filter',
                        error: deleteError.message,
                        code: deleteError.code 
                    });
                    console.error('元のメッセージの削除に失敗しました:', deleteError);
                } else {
                    logWebhookAction('DELETE-SKIP', messageId, { 
                        type: 'word-filter',
                        reason: 'Message already deleted (10008)' 
                    });
                }
            }

            logWebhookAction('COMPLETE', messageId, { type: 'word-filter' });

        } catch (error) {
            logWebhookAction('ERROR', messageId, { 
                type: 'word-filter',
                error: error.message,
                stack: error.stack?.split('\n')[0] 
            });
            console.error('特定ワード自動代行でエラーが発生しました:', error.message);
        } finally {
            // 確実にロックを解除（早期リターン時も含む）
            if (processingMessages.has(messageId)) {
                processingMessages.delete(messageId);
                logWebhookAction('UNLOCK', messageId, { 
                    type: 'word-filter',
                    processed: shouldProcess !== false 
                });
            }
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
            if (Date.now() - (info.timestamp || 0) > oneHourAgo) {
                deletedMessageInfo.delete(messageId);
                // 削除情報が消える時、送信済みマークも削除
                sentWebhookMessages.delete(messageId);
            }
        }

        // 古い処理中フラグのクリーンアップはSetなので難しいが、通常はfinallyで消える
        // 送信済みマークも1時間以上経過したものは削除
        // 注: messageIdは数値なので、タイムスタンプから推測できないため、
        // deletedMessageInfoと連動して削除する
    }, 30 * 60 * 1000);
}

module.exports = {
    setup,
    deletedMessageInfo // for imageLog to access
};
