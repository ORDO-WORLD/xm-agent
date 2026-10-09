"""Who may call what. Kept free of FastAPI so the whole matrix is unit-testable.

Roles
  admin          platform administrator (all companies, company management)
  company_admin  super admin of one company (team, settings, uploads, locks)
  user           company member (matching, status marks, dashboard, logs)
"""

ROLE_RANK = {'user': 1, 'company_admin': 2, 'admin': 3}
PUBLIC_PATHS = {'/health', '/auth/login'}
SESSION_PATHS = {'/auth/me', '/auth/logout'}
SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS'}

# Writes a regular member may perform; any other write needs a company admin.
MEMBER_WRITES = {
    ('PUT', '/preferences'), ('POST', '/workspace/recommendations'), ('POST', '/export/pdf'),
    ('POST', '/buyers/recommendations/batch'), ('POST', '/auth/logout'), ('PUT', '/auth/password'),
    ('POST', '/entities/status'), ('PUT', '/search-default/personal'), ('DELETE', '/search-default/personal'),
    ('POST', '/matches/recent/seen'),
    ('POST', '/export/all/plan'), ('POST', '/export/all/part'), ('POST', '/export/all/cancel'),
}


def normalize(path: str) -> str:
    return path.rstrip('/') or '/'


def required_role(method: str, path: str) -> str:
    """Lowest role that may call ``method path``."""
    path = normalize(path)
    if path == '/admin' or path.startswith('/admin/'):
        return 'admin'
    if path == '/integration/keys' or path.startswith('/integration/keys/'):
        return 'company_admin'
    if path == '/team' or path.startswith('/team/'):
        return 'company_admin'
    if method.upper() in SAFE_METHODS:
        return 'user'
    if (method.upper(), path) in MEMBER_WRITES:
        return 'user'
    return 'company_admin'


def role_allows(role: str, needed: str) -> bool:
    return ROLE_RANK.get(role, 0) >= ROLE_RANK[needed]


def permissions(role: str, search_locked: bool = False) -> dict:
    """What the interface may offer. The server still enforces every call."""
    admin = role_allows(role, 'company_admin')
    return {
        'platform': role == 'admin',
        'manage_team': admin,
        'manage_settings': admin,
        'upload_data': admin,
        'edit_company_search': admin,
        'edit_personal_search': (role == 'user') and not search_locked,
        'mark_status': True,
    }
