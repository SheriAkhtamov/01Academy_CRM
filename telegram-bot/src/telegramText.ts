export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Splits HTML-formatted summaries only between lines. Every HTML tag generated
 * by summary.ts is contained within one line, so line-boundary splitting keeps
 * each Telegram chunk valid HTML.
 */
export function splitTelegramText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('Telegram message limit must be a positive integer');
    }
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let currentLines: string[] = [];

    for (const line of text.split('\n')) {
        if (line.length > limit) {
            throw new RangeError('A summary line exceeds the Telegram message limit');
        }

        const candidate = [...currentLines, line].join('\n');
        if (currentLines.length > 0 && candidate.length > limit) {
            chunks.push(currentLines.join('\n'));
            currentLines = [line];
        } else {
            currentLines.push(line);
        }
    }

    if (currentLines.length > 0) chunks.push(currentLines.join('\n'));
    return chunks;
}

export function isAuthorizedCommandChat(
    configuredChatId: string,
    actualChatId: number | string,
    command: string,
): boolean {
    const configured = configuredChatId.trim();
    // /chatid remains available only for first-time bootstrap. Once a target
    // group is configured, every command is restricted to that exact chat.
    if (!configured) return command === 'chatid';
    return configured === String(actualChatId);
}
