import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import { Model } from '../../core/model.ts';

export const USERS_SHEET = 'users';

export function usersModel(adapter: SheetAdapter, now: () => Date = () => new Date()): Model {
  return new Model(USERS_SHEET, adapter, now);
}
