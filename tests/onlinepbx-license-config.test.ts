import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type AppConfig } from '../server/config';

describe('OnlinePBX license reminder recipient configuration', () => {
  it.each([undefined, [], [1], [1, 6]].map((ids) => ({ ids })))('accepts an opt-in recipient list: $ids', ({ ids }) => {
    const config: AppConfig = JSON.parse(readFileSync('config/app.config.example.json', 'utf8'));
    config.integrations!.onlinePbx!.licenseReminderUserIds = ids;
    expect(() => validateConfig(config)).not.toThrow();
  });
  it.each([[0], [-1], [1.5], ['1'], [1, 1], Array.from({ length: 21 }, (_, index) => index + 1)].map((ids) => ({ ids })))(
    'rejects invalid or ambiguous recipients: $ids', ({ ids }) => {
      const config: AppConfig = JSON.parse(readFileSync('config/app.config.example.json', 'utf8'));
      config.integrations!.onlinePbx!.licenseReminderUserIds = ids as number[];
      expect(() => validateConfig(config)).toThrow('licenseReminderUserIds');
    },
  );
});
