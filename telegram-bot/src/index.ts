import { config } from './config.js';
import { bot } from './bot.js';
import { startScheduler } from './scheduler.js';
import { closeDb } from './db.js';

async function main() {
    startScheduler();

    // Long polling for commands (/summary, /chatid, /start).
    await bot.start({
        onStart: (me) => console.log(`[bot] started as @${me.username} (tz=${config.timezone})`),
    });
}

async function shutdown() {
    console.log('\n[bot] shutting down…');
    await bot.stop().catch(() => {});
    await closeDb().catch(() => {});
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
