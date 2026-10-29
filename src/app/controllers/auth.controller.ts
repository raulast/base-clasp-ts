import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import type { Row } from '../../core/sheet-adapter.ts';
import { hashPassword, verifyPassword, signJwt } from '../../core/auth.ts';
import { usersModel } from '../models/user.model.ts';

export const LOGIN_ERROR_MESSAGE = 'Invalid email or password';
const TOKEN_TTL_SECONDS = 60 * 60;
const DUMMY_PASSWORD_FOR_TIMING = 'dummy-password-for-constant-time-login';

const dummyHashCache = new WeakMap<CryptoAdapter, string>();

function getDummyHash(crypto: CryptoAdapter): string {
  let hash = dummyHashCache.get(crypto);
  if (!hash) {
    hash = hashPassword(DUMMY_PASSWORD_FOR_TIMING, crypto);
    dummyHashCache.set(crypto, hash);
  }
  return hash;
}

export function sanitizeUser(user: Row): Row {
  const { password, ...rest } = user;
  return rest;
}

export function createUser(
  adapter: SheetAdapter,
  crypto: CryptoAdapter,
  email: string,
  password: string,
  username: string,
  now: () => Date = () => new Date(),
): Row {
  const model = usersModel(adapter, now);
  const existing = model.all({ where: (row) => row.email === email });
  if (existing.length > 0) {
    throw new Error('Email already registered');
  }
  if (model.all({ where: (row) => row.username === username }).length > 0) {
    throw new Error('Username already taken');
  }
  const created = model.create({ email, username, password: hashPassword(password, crypto) });
  return sanitizeUser(created);
}

export interface LoginResult {
  ok: boolean;
  token?: string;
}

export function login(
  adapter: SheetAdapter,
  crypto: CryptoAdapter,
  secret: string,
  email: string,
  password: string,
  now: () => Date = () => new Date(),
): LoginResult {
  const model = usersModel(adapter, now);
  const user = model.all({ where: (row) => row.email === email })[0];
  if (!user) {
    verifyPassword(password, getDummyHash(crypto), crypto);
    return { ok: false };
  }
  if (!verifyPassword(password, String(user.password), crypto)) {
    return { ok: false };
  }
  const token = signJwt({ sub: user.id }, secret, TOKEN_TTL_SECONDS, crypto, now);
  return { ok: true, token };
}

export function findUserById(adapter: SheetAdapter, userId: unknown): Row | null {
  const model = usersModel(adapter);
  const user = model.all({ where: (row) => row.id === userId })[0];
  return user ? sanitizeUser(user) : null;
}
