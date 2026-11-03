import type { Middleware } from '../../core/router.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import { verifyJwt } from '../../core/auth.ts';
import { unauthenticated } from '../../core/api.ts';

export function authMiddleware(secret: string, crypto: CryptoAdapter, now: () => Date = () => new Date()): Middleware {
  return (request, next) => {
    const token = request.body.token as string | undefined;
    if (!token) {
      throw unauthenticated('Unauthorized');
    }
    const result = verifyJwt(token, secret, crypto, now);
    if (!result.valid) {
      throw unauthenticated('Unauthorized');
    }
    request.context = { ...request.context, userId: result.payload.sub };
    return next();
  };
}
