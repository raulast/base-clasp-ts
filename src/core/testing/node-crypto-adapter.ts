import { createHmac, randomUUID } from 'node:crypto';
import type { CryptoAdapter } from '../crypto-adapter.ts';

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class NodeCryptoAdapter implements CryptoAdapter {
  hmacSha256Base64Url(message: string, key: string): string {
    return toBase64Url(createHmac('sha256', key).update(message, 'utf8').digest());
  }

  base64UrlEncode(text: string): string {
    return toBase64Url(Buffer.from(text, 'utf8'));
  }

  base64UrlDecode(text: string): string {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + '='.repeat(padding), 'base64').toString('utf8');
  }

  randomSalt(): string {
    return randomUUID();
  }
}
