export function readAuthLink(href: string) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  const type = hash.get('type') || query.get('type') || (['invite', 'recovery'].includes(query.get('auth') ?? '') ? query.get('auth')! : '');
  const accessToken = hash.get('access_token') || '';
  const refreshToken = hash.get('refresh_token') || '';
  const tokenHash = query.get('token_hash') || '';
  const legacyToken = query.get('resetToken') || '';
  const providerError = hash.has('error') || hash.has('error_code') || query.has('error') || query.has('error_code');
  const isCallback = ['complete', 'invite', 'recovery'].includes(query.get('auth') ?? '') || Boolean(type || accessToken || refreshToken || tokenHash || legacyToken || providerError || query.has('code'));
  const supportedType = ['invite', 'recovery', 'signup', 'email'].includes(type);
  const hasCredentials = Boolean((accessToken && refreshToken) || (tokenHash && supportedType) || legacyToken);
  const error = providerError ? 'This email link has expired or has already been used. Request a new link.'
    : isCallback && !hasCredentials ? 'This email link is incomplete. Open the full link from your invitation, or request a new password setup email.' : '';
  return { isCallback, type, accessToken, refreshToken, tokenHash, legacyToken, hasCredentials, error };
}
