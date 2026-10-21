import { describe, expect, it } from 'vitest';
import { redactLogValue } from '../server/lib/log-redaction';

describe('structured error logging', () => {
  it('retains non-enumerable Error details and nested network failure codes', () => {
    const network = Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT', syscall: 'connect' });
    const error = Object.assign(new TypeError('fetch failed'), { cause: network });
    expect(redactLogValue({ error })).toMatchObject({ error: {
      name: 'TypeError', message: 'fetch failed', stack: expect.stringContaining('fetch failed'),
      cause: { name: 'Error', message: 'connect failed', code: 'ETIMEDOUT', syscall: 'connect' },
    } });
  });

  it('redacts credentials in Error properties, messages, stacks and causes', () => {
    const cause = Object.assign(new Error('postgresql://crm:placeholder-password@postgres/crm'), {
      accessToken: 'private-access-value',
    });
    const error = Object.assign(new Error('Bearer private-bearer https://graph.facebook.com/?access_token=private-query'), {
      cause, authorization: 'private-header', details: { password: 'private-password' },
    });
    const serialized = JSON.stringify(redactLogValue({ error }));
    for (const secret of ['placeholder-password', 'private-access-value', 'private-bearer', 'private-query', 'private-header', 'private-password']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('postgresql://crm:');
  });

  it('handles aggregate errors and circular causes without dropping the reason', () => {
    const error = Object.assign(new Error('multiple connections failed'), {
      errors: [Object.assign(new Error('IPv6 unreachable'), { code: 'ENETUNREACH' })],
      cause: {} as unknown,
    });
    error.cause = error;
    expect(redactLogValue(error)).toMatchObject({
      message: 'multiple connections failed', cause: '[CIRCULAR]', errors: [{ code: 'ENETUNREACH' }],
    });
  });

  it('does not return an unredacted object beyond the recursion limit', () => {
    let value: object = { token: 'deep-secret' };
    for (let depth = 0; depth < 10; depth += 1) value = { nested: value };
    expect(JSON.stringify(redactLogValue(value))).not.toContain('deep-secret');
  });
});
