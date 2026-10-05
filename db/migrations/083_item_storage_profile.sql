-- 3PL slotting profile used by put-away rules and warehouse reporting.
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS storage_profile VARCHAR(20);

ALTER TABLE items
    DROP CONSTRAINT IF EXISTS ck_items_storage_profile;

ALTER TABLE items
    ADD CONSTRAINT ck_items_storage_profile
    CHECK (
        storage_profile IS NULL
        OR storage_profile IN ('HEAVY', 'FMCG', 'FULFILLMENT', 'PROJECT')
    );

CREATE INDEX IF NOT EXISTS ix_items_storage_profile
    ON items(storage_profile);
