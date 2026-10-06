import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

// The password is read from stdin, never argv, shell history, output, or source.
const args = process.argv.slice(2);
const configPath = path.resolve(process.cwd(), 'config/app.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (args.length === 1 && args[0] === '--disable') {
  config.publicAttendance = { ...config.publicAttendance, enabled: false };
} else {
  if (args.length !== 2 || args[0] !== '--groups' || !/^[1-9]\d*(?:,[1-9]\d*)*$/.test(args[1])) throw new Error('Usage: configure-public-attendance.mjs --groups ID,ID,ID or --disable');
  const groupIds = args[1].split(',').map(Number);
  if (groupIds.length > 100 || new Set(groupIds).size !== groupIds.length || groupIds.some((id) => !Number.isSafeInteger(id))) throw new Error('Invalid group IDs');
  const password = fs.readFileSync(0, 'utf8').trim();
  if (!password || password.length > 256) throw new Error('Provide the page password on stdin');
  const salt = randomBytes(16).toString('hex');
  config.publicAttendance = { enabled: true, passwordHash: `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`, groupIds };
}
// Preserve the existing owner, group, and permissions (including a group the operator cannot chown to).
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
process.stdout.write(config.publicAttendance.enabled ? `Public attendance enabled for ${config.publicAttendance.groupIds.length} groups. Restart the CRM to apply.\n` : 'Public attendance disabled. Restart the CRM to apply.\n');
