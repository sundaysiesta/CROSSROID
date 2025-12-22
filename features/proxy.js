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
const sendingWebhooks = new Set(); // webhook.send()実行中のメッセージIDを追跡（送信中のロック）

// イベントリスナーの重複登録を防ぐフラグ
let isSetupComplete = false;
let imageProxyHandler = null;
let wordProxyHandler = null;

// ログ用ヘルパー関数
function logWebhookAction(action, messageId, details = {}) {
    const timestamp = new Date().toISOString();
    const detailStr = Object.keys(details).length > 0 
        ? ` | ${JSON.stringify(details)}` 
        : '';
    console.log(`[WEBHOOK-${action}] ${timestamp} | MessageID: ${messageId}${detailStr}`);
}

function setup(client) {
    // 既にセットアップ済みの場合はスキップ（重複登録を防ぐ）
    if (isSetupComplete) {
        console.warn('[PROXY] setup()が既に呼ばれています。重複登録をスキップします。');
        return;
    }
    
    isSetupComplete = true;
    console.log('[PROXY] イベントリスナーを登録します。');

    // 画像自動代行投稿機能のハンドラー
    imageProxyHandler = async message => {
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
        
        // 送信済みチェックを早期に実行（処理開始前にチェック）
        if (sentWebhookMessages.has(messageId)) {
            logWebhookAction('SKIP-ALREADY-SENT-EARLY', messageId, { 
                reason: 'Already sent webhook (early check)' 
            });
            return;
        }
        
        // ロックを取得（先にaddすることで、他の処理が開始されないようにする）
        processingMessages.add(messageId);
        logWebhookAction('START', messageId, { 
            author: message.author.id, 
            channel: message.channel.id,
            attachmentCount: message.attachments.size,
            processingMessagesSize: processingMessages.size,
            sentWebhookMessagesSize: sentWebhookMessages.size
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
            
            // 送信前に最終チェック：既に送信済みの場合はスキップ
            if (sentWebhookMessages.has(messageId)) {
                logWebhookAction('SKIP-ALREADY-SENT-FINAL', messageId, { 
                    reason: 'Already sent webhook (final check before send)' 
                });
                return;
            }
            
            // 送信前にマーク（重複送信を防ぐ）- アトミック操作として実行
            // チェックと追加をアトミックに行う（ログ出力の前に実行）
            if (sentWebhookMessages.has(messageId)) {
                logWebhookAction('SKIP-RACE-CONDITION', messageId, { 
                    reason: 'Race condition detected - another process already sent' 
                });
                return;
            }
            // マークを先に追加（ログ出力より前に実行）
            sentWebhookMessages.add(messageId);
            
            logWebhookAction('SEND-START', messageId, { 
                webhookId: webhook.id, 
                fileCount: files.length,
                contentLength: sanitizedContent.length,
                sentWebhookMessagesSize: sentWebhookMessages.size,
                hasMark: sentWebhookMessages.has(messageId),
                sendingWebhooksSize: sendingWebhooks.size
            });
            
            // webhook.send()の直前に再度チェック（最後の防御線）
            // この時点でマークがなければ、他のプロセスが既に送信済みの可能性がある
            if (!sentWebhookMessages.has(messageId)) {
                logWebhookAction('ERROR-MARK-LOST', messageId, { 
                    reason: 'Mark was lost between add and send - aborting send',
                    sentWebhookMessagesSize: sentWebhookMessages.size
                });
                // マークが失われている場合は送信を中止
                return;
            }
            
            // webhook.send()実行中のロックをチェック
            if (sendingWebhooks.has(messageId)) {
                logWebhookAction('SKIP-SENDING-IN-PROGRESS', messageId, { 
                    reason: 'Webhook send already in progress for this message'
                });
                return;
            }
            
            // 送信ロックを取得
            sendingWebhooks.add(messageId);
            
            // Webhook送信を非同期で開始（完了を待たない）
            const webhookSendPromise = webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                files: files,
                components: [actionRow],
                allowedMentions: { parse: [] }
            }).then((webhookMessage) => {
                // 送信ロックを解除
                sendingWebhooks.delete(messageId);
                
                logWebhookAction('SEND-SUCCESS', messageId, { 
                    webhookMessageId: webhookMessage.id,
                    webhookId: webhook.id 
                });

                // 削除情報を保存（webhook送信成功時のみ）
                deletedMessageInfo.set(webhookMessage.id, {
                    content: originalContent,
                    author: originalAuthor,
                    attachments: originalAttachments,
                    channel: message.channel,
                    originalMessageId: message.id,
                    timestamp: Date.now()
                });

                return webhookMessage;
            }).catch((sendError) => {
                // 送信エラー時はマークとロックを解除
                sentWebhookMessages.delete(messageId);
                sendingWebhooks.delete(messageId);
                logWebhookAction('SEND-ERROR', messageId, { 
                    error: sendError.message,
                    code: sendError.code 
                });
                console.error(`[画像代行] Webhook送信エラー:`, sendError);
                throw sendError;
            });

            // 元のメッセージを削除（優先処理：webhook送信の完了を待たない）
            let deleteSuccess = false;
            try {
                await message.delete();
                deleteSuccess = true;
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
                    deleteSuccess = true; // 既に削除済みなので成功とみなす
                }
            }

            // クールダウンを更新（削除成功時のみ）
            if (deleteSuccess) {
                autoProxyCooldowns.set(message.author.id, Date.now());
            }

            // 削除完了時点でCOMPLETEログを出力（webhook送信の完了を待たない）
            logWebhookAction('COMPLETE', messageId, { 
                deleteSuccess: deleteSuccess,
                note: 'Webhook send may still be in progress'
            });

            // Webhook送信の完了を待つ（バックグラウンド処理）
            // エラーが発生しても処理は続行（既に削除は完了しているため）
            webhookSendPromise.catch(() => {
                // エラーは既にログ出力済み
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
    };
    
    // 画像自動代行投稿機能のイベントリスナーを登録
    client.on('messageCreate', imageProxyHandler);

    // 特定ワード自動代行機能のハンドラー
    wordProxyHandler = async message => {
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

            // Webhook送信を非同期で開始（完了を待たない）
            const webhookSendPromise = webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                allowedMentions: { parse: [] }
            }).then(() => {
                logWebhookAction('SEND-SUCCESS', messageId, { 
                    type: 'word-filter',
                    webhookId: webhook.id 
                });
            }).catch((sendError) => {
                logWebhookAction('SEND-ERROR', messageId, { 
                    type: 'word-filter',
                    error: sendError.message,
                    code: sendError.code 
                });
                console.error('特定ワード自動代行: Webhook送信エラー:', sendError);
                throw sendError;
            });

            // 元のメッセージを削除（優先処理：webhook送信の完了を待たない）
            let deleteSuccess = false;
            try {
                await message.delete();
                deleteSuccess = true;
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
                    deleteSuccess = true; // 既に削除済みなので成功とみなす
                }
            }

            // クールダウンを更新（削除成功時のみ）
            if (deleteSuccess) {
                wordProxyCooldowns.set(userId, Date.now());
            }

            // 削除完了時点でCOMPLETEログを出力（webhook送信の完了を待たない）
            logWebhookAction('COMPLETE', messageId, { 
                type: 'word-filter',
                deleteSuccess: deleteSuccess,
                note: 'Webhook send may still be in progress'
            });

            // Webhook送信の完了を待つ（バックグラウンド処理）
            // エラーが発生しても処理は続行（既に削除は完了しているため）
            webhookSendPromise.catch(() => {
                // エラーは既にログ出力済み
            });

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
    };
    
    // 特定ワード自動代行機能のイベントリスナーを登録
    client.on('messageCreate', wordProxyHandler);

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

