"""CustomerUser ORM model mapped to the customer_users table (mig 088).

Separate from models.user.User on purpose: `users` carries role /
warehouse_ids / allowed_functions and is the subject of every staff
authorisation check, so keeping portal logins in their own model means a
customer row can never be handed to a code path that expects a staff row.

Note what to_dict() deliberately does NOT return: `user_id` and `role`.
Both tables key off a SERIAL in the same numeric range, so a customer
whose id leaked into a `SELECT ... FROM users WHERE user_id = :id` lookup
would silently match an unrelated staff account. Withholding the claim
turns that class of mistake into a KeyError instead of a privilege
escalation.
"""

import bcrypt
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from models.database import Base


class CustomerUser(Base):
    __tablename__ = "customer_users"

    customer_user_id = Column(Integer, primary_key=True)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    email = Column(String(255))
    is_active = Column(Boolean, nullable=False, default=True)
    must_change_password = Column(Boolean, nullable=False, default=True)
    password_changed_at = Column(DateTime(timezone=True))
    last_login = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer)

    def to_dict(self):
        return {
            "customer_user_id": self.customer_user_id,
            "customer_id": str(self.customer_id),
            "username": self.username,
            "full_name": self.full_name,
            "email": self.email,
            "is_active": self.is_active,
            "must_change_password": bool(self.must_change_password),
        }

    def check_password(self, password):
        return bcrypt.checkpw(
            password.encode("utf-8"), self.password_hash.encode("utf-8")
        )
