import type { CryptoAdapter } from './crypto-adapter.ts';

function restorePadding(text: string): string {
  const padding = (4 - (text.length % 4)) % 4;
  return text + '='.repeat(padding);
}

export class GasCryptoAdapter implements CryptoAdapter {
  hmacSha256Base64Url(message: string, key: string): string {
    const signatureBytes = Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8);
    return Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');
  }

  base64UrlEncode(text: string): string {
    return Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8).replace(/=+$/, '');
  }

  base64UrlDecode(text: string): string {
    const bytes = Utilities.base64DecodeWebSafe(restorePadding(text));
    return Utilities.newBlob(bytes).getDataAsString('UTF-8');
  }

  randomSalt(): string {
    return Utilities.getUuid();
  }
}

// Properties reads count against a daily quota (50,000 on consumer accounts) and every authenticated
// request reads JWT_SECRET, so secrets are cached briefly. A rotated secret takes effect within this window.
export const SECRET_CACHE_SECONDS = 600;

function secretCache(): GoogleAppsScript.Cache.Cache | null {
  try {
    return CacheService.getScriptCache();
  } catch {
    return null;
  }
}

// The cache is only a shortcut: Apps Script may evict entries at any time, so any miss or cache error
// falls back to Script Properties, which stay the source of truth.
export function getScriptSecret(name: string): string {
  const key = `script-secret:${name}`;
  const cache = secretCache();
  try {
    const cached = cache?.get(key);
    if (cached) {
      return cached;
    }
  } catch {
    // fall through to Properties
  }
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error(`Missing script property: ${name}`);
  }
  try {
    cache?.put(key, value, SECRET_CACHE_SECONDS);
  } catch {
    // caching is best effort
  }
  return value;
}
