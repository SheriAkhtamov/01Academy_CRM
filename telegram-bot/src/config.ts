import 'dotenv/config';

// Make sure all Date math/formatting runs in the team's timezone.
export const TIMEZONE = process.env.TZ || 'Asia/Tashkent';
process.env.TZ = TIMEZONE;

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name} (copy .env.example to .env and fill it in)`);
    }
    return value;
}

export const config = {
    timezone: TIMEZONE,
    botToken: process.env.BOT_TOKEN ?? '',
    groupChatId: process.env.GROUP_CHAT_ID ?? '',
    databaseUrl: required('DATABASE_URL'),
    boardUrl: process.env.BOARD_URL || 'https://crm.01academy.uz/management',
};

export function requireBotConfig() {
    if (!config.botToken) throw new Error('BOT_TOKEN is not set');
}
