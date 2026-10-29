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

export function getScriptSecret(name: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error(`Missing script property: ${name}`);
  }
  return value;
}
