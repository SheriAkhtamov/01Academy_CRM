// Builds both summaries from the live DB and prints them to the console.
// No Telegram token needed — use this to verify the summary logic.
import { getActiveTasks } from './queries.js';
import { buildSummary } from './summary.js';
import { closeDb } from './db.js';

function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '');
}

async function main() {
    const tasks = await getActiveTasks();
    console.log(`Active tasks in DB: ${tasks.length}\n`);
    console.log('================ MORNING (10:00) ================');
    console.log(stripHtml(buildSummary(tasks, 'morning')));
    console.log('\n================ AFTERNOON (16:00) ==============');
    console.log(stripHtml(buildSummary(tasks, 'afternoon')));
    await closeDb();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
