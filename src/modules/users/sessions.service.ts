import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CookieOptions } from 'express';
import type { Repository } from 'typeorm';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { Session } from './session.entity.js';
import type { User } from './user.entity.js';

export const SESSION_COOKIE = 'xc_session';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 32 random bytes in base64url = 43 characters; any other shape is not a token we issued. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** HttpOnly, SameSite=Lax, host-only, `Secure` per config (auth design §4). */
export function sessionCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    maxAge: config.auth.sessionTtlDays * DAY_MS,
  };
}

/** Opaque server-side sessions (auth design A1): the cookie holds a random token, the table its SHA-256. */
@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Opens a session and returns the raw token for the cookie. The token itself is never stored. */
  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.sessions.insert({
      userId,
      tokenHash: hashOf(token),
      expiresAt: new Date(Date.now() + this.config.auth.sessionTtlDays * DAY_MS),
    });
    return token;
  }

  /** The session's user, or null when the token is missing, malformed, unknown or expired. */
  async resolve(token: unknown): Promise<User | null> {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
    const session = await this.sessions.findOne({
      where: { tokenHash: hashOf(token) },
      relations: { user: true },
    });
    if (!session?.user) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.delete({ id: session.id });
      return null;
    }
    return session.user;
  }

  /** Ends the presented session, if it is one of ours. */
  async revoke(token: unknown): Promise<void> {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return;
    await this.sessions.delete({ tokenHash: hashOf(token) });
  }
}
