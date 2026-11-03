export interface ManagingUser {
  id: unknown;
  role: string;
  disabled: boolean;
}

export function canManageUsers(user: ManagingUser | null): boolean {
  return user !== null && !user.disabled && user.role === 'admin';
}
