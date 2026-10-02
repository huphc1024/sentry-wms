"""
Cookie-based auth helpers for V-045.

The admin SPA authenticates via an HttpOnly auth cookie plus a readable
CSRF token cookie (double-submit pattern). Mobile and other bearer-token
clients continue to use the Authorization header; the cookies are
ignored on that path.
"""

import secrets

from flask import request

from services.auth_service import TOKEN_EXPIRY_HOURS

AUTH_COOKIE_NAME = "sentry_auth"
CSRF_COOKIE_NAME = "sentry_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"

# Customer portal session cookies (phase 2). Distinct names so a staff
# session and a portal session can coexist in one browser without either
# overwriting the other -- an operator checking what a customer sees would
# otherwise silently log themselves out of the admin panel, or worse, send
# a staff cookie to a portal route.
PORTAL_AUTH_COOKIE_NAME = "sentry_portal_auth"
PORTAL_CSRF_COOKIE_NAME = "sentry_portal_csrf"

CSRF_PROTECTED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _cookie_secure() -> bool:
    # True over HTTPS (direct or via a TLS-terminating reverse proxy).
    # #107: ProxyFix (wired in api/app.py behind TRUST_PROXY) is the
    # primary mechanism -- it rewrites request.scheme from X-Forwarded-
    # Proto so request.is_secure reads correctly. The header fallback
    # below stays as belt-and-suspenders for deployments that front
    # the app with HTTPS but skip TRUST_PROXY; the cookie still picks
    # up Secure, which is the safe direction.
    return bool(request.is_secure) or request.headers.get("X-Forwarded-Proto") == "https"


def set_auth_cookies(
    response,
    token: str,
    csrf_token: str,
    auth_cookie_name: str = AUTH_COOKIE_NAME,
    csrf_cookie_name: str = CSRF_COOKIE_NAME,
) -> None:
    # NOTE (V-112): SameSite=Strict is correct for the current LAN
    # deployment model. Revisit if SSO / external-link integration is
    # scoped (clicks from external providers would be cross-site nav
    # and would not carry the cookie under Strict).
    secure = _cookie_secure()
    max_age = TOKEN_EXPIRY_HOURS * 3600
    response.set_cookie(
        auth_cookie_name,
        token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="Strict",
        path="/",
    )
    response.set_cookie(
        csrf_cookie_name,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite="Strict",
        path="/",
    )


def clear_auth_cookies(
    response,
    auth_cookie_name: str = AUTH_COOKIE_NAME,
    csrf_cookie_name: str = CSRF_COOKIE_NAME,
) -> None:
    secure = _cookie_secure()
    response.set_cookie(
        auth_cookie_name,
        "",
        expires=0,
        max_age=0,
        httponly=True,
        secure=secure,
        samesite="Strict",
        path="/",
    )
    response.set_cookie(
        csrf_cookie_name,
        "",
        expires=0,
        max_age=0,
        httponly=False,
        secure=secure,
        samesite="Strict",
        path="/",
    )


def csrf_token_matches(csrf_cookie_name: str = CSRF_COOKIE_NAME) -> bool:
    header = request.headers.get(CSRF_HEADER_NAME)
    cookie = request.cookies.get(csrf_cookie_name)
    if not header or not cookie:
        return False
    return secrets.compare_digest(header, cookie)
