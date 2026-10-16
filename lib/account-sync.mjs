/** Pure helpers: no browser side effects until the session gate explicitly navigates. */
export function actorKey(user) {
  return JSON.stringify([user.id, user.role, user.workspace_id ?? null]);
}
export function returnRoute(hash) {
  return /^#\/(beranda|cocokkan|match-baru|stok|data|tim|pengaturan|perusahaan|aktivitas)(\?[^#\r\n]*)?$/.test(hash || '') ? `/${hash}` : '/';
}
export function startUrl(hash) {
  return `/api/auth/sso/start?next=${encodeURIComponent(returnRoute(hash))}`;
}
