import bcrypt from 'bcrypt';
import { storage } from '../storage';
import type { User, InsertUser } from '@shared/schema';
import type { SanitizedUser } from '@shared/auth';

class AuthService {
  private saltRounds = 10;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  async authenticateUser(loginOrEmailId: string, password: string): Promise<User | null> {
    const user = await storage.getUserByLoginOrEmail(loginOrEmailId);
    if (!user || !user.isActive) {
      return null;
    }

    const isValidPassword = await this.verifyPassword(password, user.password);
    if (!isValidPassword) {
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
    const { password, ...sanitizedUser } = user;
    return sanitizedUser;
  }
}

export const authService = new AuthService();
