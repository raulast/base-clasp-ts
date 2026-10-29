import type { CryptoAdapter } from './crypto-adapter.ts';

export type JwtPayload = Record<string, unknown> & { iat: number; exp: number };

export type VerifyJwtResult =
  | { valid: true; payload: JwtPayload }
  | { valid: false; reason: 'malformed' | 'algorithm' | 'signature' | 'expired' };

// Caps work per verification so a tampered stored hash cannot exhaust GAS's 6-minute execution limit.
export const MAX_PASSWORD_ITERATIONS = 100_000;

function hmacIterated(password: string, salt: string, iterations: number, crypto: CryptoAdapter): string {
  let value = crypto.hmacSha256Base64Url(password, salt);
  for (let i = 1; i < iterations; i++) {
    value = crypto.hmacSha256Base64Url(value, salt);
  }
  return value;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function hashPassword(password: string, crypto: CryptoAdapter, iterations = 1000): string {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PASSWORD_ITERATIONS) {
    throw new RangeError(`iterations must be an integer between 1 and ${MAX_PASSWORD_ITERATIONS}`);
  }
  const salt = crypto.randomSalt();
  const hash = hmacIterated(password, salt, iterations, crypto);
  return `${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string, crypto: CryptoAdapter): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) {
    return false;
  }
  const [iterationsText, salt, hash] = parts;
  const iterations = Number(iterationsText);
  if (
    !/^\d+$/.test(iterationsText) ||
    iterations < 1 ||
    iterations > MAX_PASSWORD_ITERATIONS ||
    salt.length === 0 ||
    hash.length === 0
  ) {
    return false;
  }
  const candidate = hmacIterated(password, salt, iterations, crypto);
  return constantTimeEqual(candidate, hash);
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number,
  crypto: CryptoAdapter,
  now: () => Date = () => new Date(),
): string {
  const header = crypto.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(now().getTime() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat, exp: iat + expiresInSeconds };
  const encodedPayload = crypto.base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto.hmacSha256Base64Url(`${header}.${encodedPayload}`, secret);
  return `${header}.${encodedPayload}.${signature}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  crypto: CryptoAdapter,
  now: () => Date = () => new Date(),
): VerifyJwtResult {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed' };
  }
  const [header, payload, signature] = parts;

  let decodedHeader: unknown;
  let decodedPayload: unknown;
  try {
    decodedHeader = JSON.parse(crypto.base64UrlDecode(header));
    decodedPayload = JSON.parse(crypto.base64UrlDecode(payload));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (
    typeof decodedHeader !== 'object' ||
    decodedHeader === null ||
    (decodedHeader as { alg?: unknown }).alg !== 'HS256'
  ) {
    return { valid: false, reason: 'algorithm' };
  }

  if (
    typeof decodedPayload !== 'object' ||
    decodedPayload === null ||
    typeof (decodedPayload as { exp?: unknown }).exp !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }

  const expectedSignature = crypto.hmacSha256Base64Url(`${header}.${payload}`, secret);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return { valid: false, reason: 'signature' };
  }

  const jwtPayload = decodedPayload as JwtPayload;
  const nowSeconds = Math.floor(now().getTime() / 1000);
  if (jwtPayload.exp < nowSeconds) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload: jwtPayload };
}
