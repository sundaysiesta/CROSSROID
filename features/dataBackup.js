const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { EVENT_CATEGORY_ID, ADMIN_ROLE_ID } = require('../constants');

// Backup targets
const FILES_TO_BACKUP = [
    'poll_data.json',
    'activity_data.json'
];

const BACKUP_CHANNEL_NAME = '🛡️db-backup-internal';

async function performBackup(client) {
    console.log('[Backup] Starting database backup...');

    const guild = client.guilds.cache.first(); // Assuming single guild bot for now
    if (!guild) return;

    // 1. Find or Create Backup Channel
    let channel = guild.channels.cache.find(c => c.name === BACKUP_CHANNEL_NAME);

    if (!channel) {
        try {
            channel = await guild.channels.create({
                name: BACKUP_CHANNEL_NAME,
                type: ChannelType.GuildText,
                parent: EVENT_CATEGORY_ID, // Put in event category or root? Maybe root is safer if category perms are weird. Let's try root first or specific ID if manageable. User said "visible only to admin and bot".
                // Let's force specific overwrites
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: ADMIN_ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                    }
                ],
                topic: 'DATABASE BACKUP CHANNEL - DO NOT DELETE MESSAGES MANUALLY.'
            });
            console.log('[Backup] Created backup channel.');
        } catch (e) {
            console.error('[Backup] Failed to create channel:', e);
            return;
        }
    }

    // 2. Prepare Files
    const files = [];
    for (const filename of FILES_TO_BACKUP) {
        const filePath = path.join(__dirname, '..', filename);
        if (fs.existsSync(filePath)) {
            files.push({
                attachment: filePath,
                name: `${new Date().toISOString().split('T')[0]}_${filename}` // Prefix date
            });
        }
    }

    if (files.length === 0) {
        console.log('[Backup] No data files found to backup.');
        return;
    }

    // 3. Send Backup
    try {
        await channel.send({
            content: `🔒 **Automated Database Backup** (${new Date().toLocaleString('ja-JP')})\n⚠️ **WARNING**: This is a raw data backup. Do not modify these files manually unless restoring.\nこのチャンネルはデータベースのバックアップ用です。手動で削除しないでください。`,
            files: files
        });
        console.log('[Backup] Backup sent successfully.');
    } catch (e) {
        console.error('[Backup] Failed to send backup:', e);
    }
}

function setup(client) {
    // Run backup on startup (with slight delay to ensure cache ready)
    setTimeout(() => performBackup(client), 10 * 1000);

    // Schedule: Every 12 hours?
    setInterval(() => performBackup(client), 12 * 60 * 60 * 1000);
}

module.exports = { setup, performBackup };
