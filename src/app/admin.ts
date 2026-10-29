export function isAdmin(email: string, adminEmails: string): boolean {
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !adminEmails) {
    return false;
  }
  return adminEmails
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .includes(normalizedEmail);
}
