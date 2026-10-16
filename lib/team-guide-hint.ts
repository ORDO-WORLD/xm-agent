const DISMISSED = 'xm.team-guide.dismissed:';
const SEEN = 'xm.team-guide.seen:';

/** Account-specific dismissal is persistent; automatic hiding lasts only for this login. */
export function claimTeamGuideHint(userId: string) {
  try {
    if (window.localStorage.getItem(DISMISSED + userId) || window.sessionStorage.getItem(SEEN + userId)) return false;
    window.sessionStorage.setItem(SEEN + userId, '1');
    return true;
  } catch { return false; }
}

export function dismissTeamGuideHint(userId: string) {
  try { window.localStorage.setItem(DISMISSED + userId, '1'); } catch { /* storage unavailable */ }
}

export function resetTeamGuideSession() {
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index));
    keys.forEach((key) => { if (key?.startsWith(SEEN)) window.sessionStorage.removeItem(key); });
  } catch { /* storage unavailable */ }
}
