import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { storage } from '../storage';
import type { User, InsertUser } from '@shared/schema';
import type { SanitizedUser } from '@shared/auth';
import {
  getPasswordPolicyError,
  isPasswordWithinBcryptLimit,
} from '../lib/password-policy';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString('base64url'),
  12,
);

class AuthService {
  private saltRounds = 12;

  async hashPassword(password: string): Promise<string> {
    const policyError = getPasswordPolicyError(password);
    if (policyError) {
      throw Object.assign(new Error(policyError), { statusCode: 400 });
    }
    return bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    if (!isPasswordWithinBcryptLimit(password)) return false;
    return bcrypt.compare(password, hashedPassword);
  }

  async authenticateUser(loginOrEmailId: string, password: string): Promise<User | null> {
    const trimmedLogin = loginOrEmailId.trim();
    const normalizedLogin = trimmedLogin.includes('@')
      ? trimmedLogin.toLowerCase()
      : trimmedLogin;
    const shouldLookup = normalizedLogin.length > 0 && normalizedLogin.length <= 254;
    const user = shouldLookup
      ? await storage.getUserByLoginOrEmail(normalizedLogin)
      : null;

    const passwordForComparison = isPasswordWithinBcryptLimit(password)
      ? password
      : 'invalid-password';
    const isValidPassword = await bcrypt.compare(
      passwordForComparison,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !user.isActive || !isValidPassword) {
      return null;
    }

    return user;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const hashedPassword = await this.hashPassword(userData.password);
    const userWithHashedPassword = {
      ...userData,
      password: hashedPassword,
    };

    return await storage.createUser(userWithHashedPassword);
  }

  sanitizeUser(user: User): SanitizedUser {
    const { password, credentialPasswordCiphertext, ...sanitizedUser } = user;
    return sanitizedUser;
  }
}

export const authService = new AuthService();
