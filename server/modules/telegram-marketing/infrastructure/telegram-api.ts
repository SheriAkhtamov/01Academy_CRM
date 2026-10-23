export async function marketingTelegramApi<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as { ok?: boolean; result?: T };
  if (!response.ok || !payload.ok) throw new Error('telegramMarketingUnavailable');
  return payload.result as T;
}
