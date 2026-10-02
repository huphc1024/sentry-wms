-- Migration 088: customer portal login accounts (Customer Portal phase 1)
--
-- Deliberately a separate table from `users` rather than a third value in
-- users.role. `users` carries role / warehouse_ids / allowed_functions and
-- is the subject of every staff authorisation check in
-- api/middleware/auth_middleware.py; putting customer accounts in the same
-- table means every one of those checks becomes a place where a customer
-- row could be mistaken for a staff row. A separate table makes "a
-- customer cannot reach a staff endpoint" a property of the schema instead
-- of a property of getting all the WHERE clauses right.
--
-- Rate limiting reuses the existing `login_attempts` table: its `key` is
-- an opaque VARCHAR, so the portal login handler keys on
-- 'customer:<username>' and cannot collide with the staff namespace.

BEGIN;

CREATE TABLE IF NOT EXISTS customer_users (
    customer_user_id    SERIAL       PRIMARY KEY,
    -- ON DELETE RESTRICT: deleting a customer must not orphan (or
    -- silently destroy) its logins. Deactivate instead.
    customer_id         UUID         NOT NULL
                            REFERENCES customers(canonical_id) ON DELETE RESTRICT,
    username            VARCHAR(50)  NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    full_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(255),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Mirrors users.must_change_password: an operator-provisioned account
    -- is forced through the change-password flow on first login.
    must_change_password BOOLEAN     NOT NULL DEFAULT TRUE,
    password_changed_at TIMESTAMPTZ,
    last_login          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by          INT          REFERENCES users(user_id) ON DELETE SET NULL,
    external_id         UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid()
);

-- username is globally unique (above) so two customers cannot provision
-- the same login. This index serves the admin-side "list logins for
-- customer X" query.
CREATE INDEX IF NOT EXISTS ix_customer_users_customer
    ON customer_users(customer_id) WHERE is_active = TRUE;

-- ------------------------------------------------------------
-- Per-feature grants
-- ------------------------------------------------------------
-- Same shape as user_page_permissions (mig 061), with one difference:
-- there is no ADMIN-style bypass. A customer_user sees a portal feature
-- only with an explicit row here, so a freshly created account with no
-- grants can log in, change its password, and see nothing else.
-- Valid feature_key values live in api/constants.py
-- (ALL_CUSTOMER_FEATURE_KEYS) -- not a CHECK constraint here, matching how
-- ALL_PAGE_KEYS governs user_page_permissions.page_key.
CREATE TABLE IF NOT EXISTS customer_user_permissions (
    customer_user_id INT          NOT NULL
                         REFERENCES customer_users(customer_user_id) ON DELETE CASCADE,
    feature_key      VARCHAR(64)  NOT NULL,
    granted_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    granted_by       INT          REFERENCES users(user_id) ON DELETE SET NULL,
    PRIMARY KEY (customer_user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS ix_customer_user_permissions_user
    ON customer_user_permissions(customer_user_id);

COMMIT;
