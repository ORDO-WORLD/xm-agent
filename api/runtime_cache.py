"""Tiny in-process caches shared by routes (one API process serves many tabs)."""
import time
from threading import Lock

STATS_TTL = 15
_lock = Lock()
_stats_cache = {}
_values = {}


def cached_stats(workspace, loader, *, version=None):
    """Share counters per workspace, refreshing immediately after a worker rebuild."""
    with _lock:
        cached = _stats_cache.get(workspace)
        if cached is not None and cached[2] == version and time.monotonic() - cached[0] < STATS_TTL:
            return cached[1]
    value = loader()
    with _lock:
        _stats_cache[workspace] = (time.monotonic(), value, version)
    return value


def cached_value(workspace, key, ttl, loader):
    """Memoise an expensive read for a few seconds, per workspace. Never shared between companies."""
    full = (workspace, key)
    with _lock:
        cached = _values.get(full)
        if cached is not None and time.monotonic() - cached[0] < ttl:
            return cached[1]
    value = loader()
    with _lock:
        if len(_values) > 500:
            _values.clear()
        _values[full] = (time.monotonic(), value)
    return value


def invalidate_stats(workspace=None):
    """Called when something users can see changes right away (a status mark)."""
    with _lock:
        if workspace is None:
            _stats_cache.clear()
            _values.clear()
        else:
            _stats_cache.pop(workspace, None)
            for key in [key for key in _values if key[0] == workspace]:
                del _values[key]
