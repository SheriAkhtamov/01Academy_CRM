import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('Instagram access-token reconnect', () => {
  it('validates the profile, subscribes webhooks, and replaces the encrypted token', () => {
    const service = read('server/services/instagram-reconnect.ts');
    expect(service).toContain('reconnectInstagramAccountWithAccessToken');
    expect(service).toContain("profileUrl.searchParams.set('fields', 'user_id,username')");
    expect(service).toContain("subscriptionUrl.searchParams.set('subscribed_fields', WEBHOOK_FIELDS.join(','))");
    expect(service).toContain("'messaging_referral'");
    expect(service).not.toContain("'messaging_referrals'");
    expect(service).toContain('encryptInstagramToken(accessToken)');
    expect(service).toContain("status = 'connected'");
    expect(service).toContain('last_error = NULL');
  });

  it('passes the token only through secrets and environment variables', () => {
    const script = read('scripts/reconnect-instagram.ts');
    const workflow = read('.github/workflows/reconnect-instagram.yml');
    const packageJson = read('package.json');
    expect(script).toContain('process.env.INSTAGRAM_RECONNECT_TOKEN');
    expect(script).not.toContain('process.argv[index');
    expect(script).toContain("module_access.module = 'administration'");
    expect(script).toContain('importInstagramConversationHistory(requestedBy)');
    expect(workflow).toContain('secrets.INSTAGRAM_RECONNECT_TOKEN');
    expect(workflow).toContain("IFS= read -r INSTAGRAM_RECONNECT_TOKEN");
    expect(workflow).toContain('-e INSTAGRAM_RECONNECT_TOKEN');
    expect(packageJson).toContain('scripts/reconnect-instagram.ts');
  });
});
