function extractRoleValue(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    if (typeof input.role === 'string') return input.role;
    if (typeof input.user_role === 'string') return input.user_role;
  }
  return '';
}

export function normalizeRole(input) {
  const raw = extractRoleValue(input);
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function isAdmin(input) {
  return normalizeRole(input) === 'admin';
}

export function isUser(input) {
  return normalizeRole(input) === 'user';
}

export function roleLabel(input) {
  const normalized = normalizeRole(input);
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'user') return 'User';
  return 'N/A';
}
