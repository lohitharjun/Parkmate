export function safeAuthReturnPath(value, origin = 'https://parkmate.invalid') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  const pathOnly = value.split(/[?#]/, 1)[0];
  if (pathOnly === '/auth' || pathOnly.startsWith('/auth/')) return null;
  try {
    const destination = new URL(value, origin);
    if (destination.origin !== origin) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

export function workspaceForRole(role) {
  return role === 'provider' ? '/provider/dashboard' : '/consumer/search';
}

export function returnPathMatchesRole(path, role) {
  const pathOnly = String(path || '').split(/[?#]/, 1)[0];
  if (pathOnly.startsWith('/provider/')) return role === 'provider';
  if (pathOnly.startsWith('/consumer/')) return role === 'consumer';
  return true;
}
