import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recoverable password purge migration', () => {
  it('removes every stored reversible password value', () => {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), 'migrations/0066_purge_recoverable_passwords.sql'),
      'utf8',
    );

    expect(sql).toMatch(/UPDATE\s+"users"/i);
    expect(sql).toMatch(/credential_password_ciphertext"\s*=\s*NULL/i);
    expect(sql).toMatch(/IS\s+NOT\s+NULL/i);
  });
});
