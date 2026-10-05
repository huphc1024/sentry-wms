"""Login lockout bookkeeping shared by the staff and portal logins.

Extracted from routes/auth.py when the customer portal gained its own
login (phase 3). The portal previously reached into routes.auth for the
underscore-private helpers, which meant a rename in the staff login would
silently break portal lockout -- i.e. quietly remove brute-force
protection from the customer-facing surface. One definition, imported by
both, removes that failure mode.

routes/auth.py keeps underscore aliases for these names: an existing test
imports routes.auth._normalize_rate_limit_key directly.

Both callers key their buckets with their own prefix ('user:' /
'customer:user:'), and login_attempts.key is an opaque VARCHAR, so the
two namespaces cannot collide -- a customer spraying passwords cannot
lock out a staff account that happens to share a username.
"""

import hashlib
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

# #35: env-configurable so a shared-IP deployment can raise the ceiling
# without a code change. Defaults preserve the historical 5 / 15.
MAX_LOGIN_ATTEMPTS = int(os.getenv("MAX_LOGIN_ATTEMPTS", "5"))
LOCKOUT_MINUTES = int(os.getenv("LOGIN_LOCKOUT_MINUTES", "15"))
# V-024: cap login_attempts.key at 64 chars so an attacker cannot bloat
# the table by spraying long random usernames. Anything longer is SHA-256
# hashed (hex digest = 64 chars) before it reaches the DB.
LOGIN_ATTEMPT_KEY_MAX_LEN = 64


def normalize_rate_limit_key(key: str) -> str:
    if len(key) <= LOGIN_ATTEMPT_KEY_MAX_LEN:
        return key
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def check_rate_limit(db, key):
    """Check if a rate-limit key is locked out. Returns (locked, remaining_seconds)."""
    key = normalize_rate_limit_key(key)
    row = db.execute(
        text("SELECT attempts, locked_until FROM login_attempts WHERE key = :key"),
        {"key": key},
    ).fetchone()
    if not row or not row.locked_until:
        return False, 0
    now = datetime.now(timezone.utc)
    if row.locked_until > now:
        remaining = int((row.locked_until - now).total_seconds())
        return True, remaining
    return False, 0


def record_failure(db, key, allow_lockout):
    """Record a failed login attempt against ``key``.

    V-023 / #35: only keys passed with ``allow_lockout=True`` ever set
    ``locked_until``. The login path locks on the ``(IP, username)``
    tuple; the username-only key is still incremented for observability
    but never locks -- an attacker spamming a username from one IP cannot
    lock the real user out from a different IP.

    Returns (locked_out, attempts_remaining). ``locked_out`` is only True
    when ``allow_lockout`` is also True and the key has crossed the
    threshold.
    """
    key = normalize_rate_limit_key(key)
    lockout_at = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
    db.execute(
        text("""
            INSERT INTO login_attempts (key, attempts, last_attempt)
            VALUES (:key, 1, NOW())
            ON CONFLICT (key) DO UPDATE
            SET attempts = login_attempts.attempts + 1, last_attempt = NOW()
        """),
        {"key": key},
    )
    row = db.execute(
        text("SELECT attempts FROM login_attempts WHERE key = :key"),
        {"key": key},
    ).fetchone()
    if allow_lockout and row and row.attempts >= MAX_LOGIN_ATTEMPTS:
        db.execute(
            text(
                "UPDATE login_attempts SET locked_until = :until, attempts = 0 "
                "WHERE key = :key"
            ),
            {"key": key, "until": lockout_at},
        )
        db.commit()
        return True, 0
    db.commit()
    return False, MAX_LOGIN_ATTEMPTS - (row.attempts if row else 0)


def reset_attempts(db, key):
    """Clear attempts after successful login."""
    key = normalize_rate_limit_key(key)
    db.execute(
        text("DELETE FROM login_attempts WHERE key = :key"),
        {"key": key},
    )
    db.commit()
