import type { CellValue, SheetAdapter, Row } from '../../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { noopLock } from '../../core/lock-adapter.ts';
import { Model } from '../../core/model.ts';
import { sameId } from '../../core/relations.ts';
import { hashPassword, verifyPassword, signJwt } from '../../core/auth.ts';
import { validationError, conflict, notFound, forbidden } from '../../core/api.ts';

export const USERS_SHEET = 'users';
export const LOGIN_ERROR_MESSAGE = 'Invalid email or password';

export const ROLES = ['admin', 'author', 'reader'] as const;
export type Role = (typeof ROLES)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;
// Bounds hashing work on register and login for oversized inputs.
export const MAX_PASSWORD_LENGTH = 256;

export function normalizeRole(role: unknown): Role {
  return typeof role === 'string' && (ROLES as readonly string[]).includes(role) ? (role as Role) : 'reader';
}

export function isDisabled(value: unknown): boolean {
  return value === true || value === 'TRUE' || value === 'true';
}

function validateUserInput(email: string, password: string, username: string, role: string): void {
  const details: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(email)) {
    details.email = 'Invalid email format';
  }
  if (!USERNAME_PATTERN.test(username)) {
    details.username = 'Username must be 3-30 characters of letters, numbers, _ or -';
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    details.password = `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`;
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    details.role = 'Invalid role';
  }
  if (Object.keys(details).length > 0) {
    throw validationError(details);
  }
}
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

export function usersModel(adapter: SheetAdapter, now: () => Date = () => new Date(), lock: LockAdapter = noopLock): Model {
  return new Model(USERS_SHEET, adapter, now, lock);
}

export function sanitizeUser(user: Row): Row {
  const { password, ...rest } = user;
  return { ...rest, role: normalizeRole(user.role), disabled: isDisabled(user.disabled) };
}

export function createUser(
  adapter: SheetAdapter,
  crypto: CryptoAdapter,
  email: string,
  password: string,
  username: string,
  role: string = 'reader',
  now: () => Date = () => new Date(),
  lock: LockAdapter = noopLock,
): Row {
  validateUserInput(email, password, username, role);
  const model = usersModel(adapter, now, lock);
  return model.withLock(() => {
    const existing = model.all({ where: (row) => row.email === email });
    if (existing.length > 0) {
      throw conflict('Email already registered');
    }
    if (model.all({ where: (row) => row.username === username }).length > 0) {
      throw conflict('Username already taken');
    }
    const created = model.create({ email, username, password: hashPassword(password, crypto), role, disabled: false });
    return sanitizeUser(created);
  });
}

export interface LoginResult {
  ok: boolean;
  token?: string;
}

export function authenticate(
  adapter: SheetAdapter,
  crypto: CryptoAdapter,
  secret: string,
  email: string,
  password: string,
  now: () => Date = () => new Date(),
): LoginResult {
  // No stored password can be this long, so reject before any hashing (for known and unknown emails alike).
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false };
  }
  const model = usersModel(adapter, now);
  const user = model.all({ where: (row) => row.email === email })[0];
  if (!user) {
    verifyPassword(password, getDummyHash(crypto), crypto);
    return { ok: false };
  }
  const passwordValid = verifyPassword(password, String(user.password), crypto);
  if (!passwordValid || isDisabled(user.disabled)) {
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

const DEFAULT_USERS_PER_PAGE = 10;
const MAX_USERS_PER_PAGE = 50;

export interface UserDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
}

export interface ListUsersFilters {
  page?: unknown;
  perPage?: unknown;
}

export interface ListUsersResult {
  data: Row[];
  meta: { page: number; perPage: number; total: number; pages: number };
}

export function listUsers(deps: UserDeps, filters: ListUsersFilters): ListUsersResult {
  const page = filters.page === undefined ? 1 : Number(filters.page);
  const perPage = filters.perPage === undefined ? DEFAULT_USERS_PER_PAGE : Number(filters.perPage);
  if (!Number.isInteger(page) || page < 1) {
    throw validationError({ page: 'Page must be a positive integer' });
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_USERS_PER_PAGE) {
    throw validationError({ perPage: `perPage must be between 1 and ${MAX_USERS_PER_PAGE}` });
  }

  const model = usersModel(deps.adapter, deps.now, deps.lock);
  const rows = model.all();
  const total = rows.length;
  const start = (page - 1) * perPage;
  const data = rows.slice(start, start + perPage).map((row) => sanitizeUser(row));

  return { data, meta: { page, perPage, total, pages: Math.ceil(total / perPage) } };
}

export interface AdminActor {
  id: CellValue;
  role: string;
  disabled: boolean;
}

export interface UpdateUserAdminInput {
  role?: unknown;
  disabled?: unknown;
}

export function updateUserAdmin(deps: UserDeps, actor: AdminActor, targetId: CellValue, input: UpdateUserAdminInput): Row {
  const model = usersModel(deps.adapter, deps.now, deps.lock);
  const target = model.find(targetId);
  if (!target) {
    throw notFound('User not found');
  }
  if (sameId(actor.id, target.id)) {
    throw forbidden('Admins cannot change their own role or disabled state');
  }

  const details: Record<string, string> = {};
  if (input.role !== undefined && !(ROLES as readonly string[]).includes(input.role as string)) {
    details.role = 'Invalid role';
  }
  if (input.disabled !== undefined && typeof input.disabled !== 'boolean') {
    details.disabled = 'disabled must be a boolean';
  }
  if (Object.keys(details).length > 0) {
    throw validationError(details);
  }

  const changes: Partial<Row> = {};
  if (input.role !== undefined) {
    changes.role = input.role as string;
  }
  if (input.disabled !== undefined) {
    changes.disabled = input.disabled as boolean;
  }

  const updated = model.update(target.id, changes) as Row;
  return sanitizeUser(updated);
}
