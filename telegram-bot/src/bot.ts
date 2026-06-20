import { Bot } from 'grammy';
import { config, requireBotConfig } from './config.js';
import { getActiveTasks } from './queries.js';
import { buildSummary, type SummaryKind } from './summary.js';

requireBotConfig();

export const bot = new Bot(config.botToken);

bot.command('start', (ctx) =>
    ctx.reply(
        'Бот микроменеджмента доски 01Academy CRM.\n\n' +
        'Сводки задач публикуются автоматически в 10:00 и 16:00 (Пн–Пт, Ташкент).\n\n' +
        'Команды:\n' +
        '/summary — показать сводку сейчас\n' +
        '/chatid — узнать id этого чата',
    ),
);

// Helps the user grab the group id to put in GROUP_CHAT_ID.
bot.command('chatid', (ctx) =>
    ctx.reply(`chat id: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' }),
);

// On-demand summary in the current chat (for testing / manual checks).
bot.command('summary', async (ctx) => {
    const tasks = await getActiveTasks();
    const text = buildSummary(tasks, currentKind());
    await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
});

function currentKind(): SummaryKind {
    const hour = Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hour12: false }).format(new Date()),
    );
    return hour < 13 ? 'morning' : 'afternoon';
}

// Posts a scheduled summary to the configured group.
export async function sendSummaryToGroup(kind: SummaryKind): Promise<void> {
    if (!config.groupChatId) {
        console.warn('[bot] GROUP_CHAT_ID is not set — skipping scheduled summary');
        return;
    }
    const tasks = await getActiveTasks();
    const text = buildSummary(tasks, kind);
    await bot.api.sendMessage(config.groupChatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });
    console.log(`[bot] sent ${kind} summary to ${config.groupChatId}`);
}
