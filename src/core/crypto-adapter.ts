/**
 * HMAC/base64url/randomness primitives auth.ts needs, kept out of model.ts/
 * sheet-adapter.ts style business logic so Node and GAS can each provide
 * their own backing implementation without auth.ts changing.
 */
export interface CryptoAdapter {
  hmacSha256Base64Url(message: string, key: string): string;
  base64UrlEncode(text: string): string;
  base64UrlDecode(text: string): string;
  randomSalt(): string;
}
