"""
Authentication business logic: login, JWT generation, and token decoding.
"""

import os
import uuid
from datetime import datetime, timezone, timedelta

import jwt

from models.customer_user import CustomerUser
from models.user import User

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is required")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRY_HOURS = 8

# Audience of a JWT. Both subject types are signed with the same secret,
# so the claim -- not the mere fact that a signature verifies -- is what
# decides which decorator will accept a token.
#
# Tokens issued before this claim existed carry neither value; every
# reader treats a missing subject_type as SUBJECT_STAFF, which is what
# those tokens were.
SUBJECT_STAFF = "staff"
SUBJECT_CUSTOMER = "customer"


def validate_password(password):
    """Return an error message if the password is invalid, or None if valid."""
    # Reject the literal string "admin" (case-insensitive, whitespace-stripped).
    # Covers "admin", "ADMIN", "Admin", "aDmIn", " admin ", "\tadmin\n", etc.
    # Checked before length so the error is specific instead of the generic
    # length message. Matters most after the v1.4.1 forced-password-change
    # flow, where the default seed credential is literally "admin" and we
    # must block users from "changing" back to it.
    if password.strip().lower() == "admin":
        return "Password cannot be 'admin'"
    if len(password) < 8:
        return "Password must be at least 8 characters"
    if not any(c.isalpha() for c in password):
        return "Password must contain at least one letter"
    if not any(c.isdigit() for c in password):
        return "Password must contain at least one digit"
    return None


def authenticate_user(db_session, username, password):
    user = (
        db_session.query(User)
        .filter(User.username == username, User.is_active == True)
        .first()
    )
    if not user or not user.check_password(password):
        return None

    user.last_login = datetime.now(timezone.utc)
    db_session.commit()
    return user.to_dict()


def generate_token(user_dict):
    now = datetime.now(timezone.utc)
    payload = {
        "subject_type": SUBJECT_STAFF,
        "user_id": user_dict["user_id"],
        "username": user_dict["username"],
        "role": user_dict["role"],
        "warehouse_id": user_dict["warehouse_id"],
        "warehouse_ids": user_dict.get("warehouse_ids", []),
        "iat": int(now.timestamp()),
        "jti": str(uuid.uuid4()),
        "exp": now + timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def authenticate_customer_user(db_session, username, password):
    """Authenticate a customer portal login. Returns a dict or None.

    Queries customer_users only -- a staff username can never authenticate
    here, and a portal username can never authenticate via
    authenticate_user() above, because neither function looks at the other
    table. customer_users.username is globally UNIQUE (mig 088), so a
    login cannot be ambiguous across customers.
    """
    cu = (
        db_session.query(CustomerUser)
        .filter(CustomerUser.username == username, CustomerUser.is_active == True)
        .first()
    )
    if not cu or not cu.check_password(password):
        return None

    cu.last_login = datetime.now(timezone.utc)
    db_session.commit()
    return cu.to_dict()


def generate_customer_token(customer_user_dict):
    """Mint a portal JWT.

    The payload carries NO `user_id` and NO `role`. That is the whole
    point: `users.user_id` and `customer_users.customer_user_id` are both
    SERIALs in the same numeric range, so a customer id reaching a staff
    lookup like `SELECT ... FROM users WHERE user_id = :id` would match a
    real staff account. Omitting the claim makes such a slip raise a
    KeyError rather than silently authorise the wrong subject.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "subject_type": SUBJECT_CUSTOMER,
        "customer_user_id": customer_user_dict["customer_user_id"],
        "customer_id": customer_user_dict["customer_id"],
        "username": customer_user_dict["username"],
        "iat": int(now.timestamp()),
        "jti": str(uuid.uuid4()),
        "exp": now + timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
