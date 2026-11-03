import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { ok, forbidden } from '../../core/api.ts';
import { listUsers, updateUserAdmin, type AdminActor } from '../models/user.model.ts';
import { canManageUsers, type ManagingUser } from '../policies/user.policy.ts';

export interface UsersControllerDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
}

export interface UsersController {
  list: (request: Request) => Response;
  update: (request: Request) => Response;
}

function toManagingUser(user: Request['user']): ManagingUser | null {
  if (!user) {
    return null;
  }
  return { id: user.id, role: String(user.role), disabled: user.disabled === true };
}

function requireManager(request: Request): AdminActor {
  const user = toManagingUser(request.user ?? null);
  if (!canManageUsers(user)) {
    throw forbidden('Only admins can manage users');
  }
  return user as AdminActor;
}

export function createUsersController(deps: UsersControllerDeps): UsersController {
  const list = (request: Request): Response => {
    requireManager(request);
    const { data, meta } = listUsers(deps, { ...request.params, ...request.body });
    return ok(data, meta);
  };

  const update = (request: Request): Response => {
    const actor = requireManager(request);
    const id = request.pathParams?.id ?? '';
    const updated = updateUserAdmin(deps, actor, id, { role: request.body.role, disabled: request.body.disabled });
    return ok(updated);
  };

  return { list, update };
}
