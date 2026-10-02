-- Migration 090: sequence backing portal-submitted SO numbers (phase 3)
--
-- POST /api/portal/orders needs a unique sales_orders.so_number. The two
-- obvious alternatives both break under concurrency: a timestamp collides
-- when one customer submits twice in the same tick, and
-- COUNT(*)+1 / MAX(...)+1 collide whenever two submissions interleave
-- (and are not fixed by wrapping them in the request transaction --
-- concurrent readers see the same count and both commit). A sequence hands
-- out distinct values without taking a lock.
--
-- Not per-customer: one global sequence keeps so_number unique across the
-- whole table, which is what the UNIQUE constraint on so_number actually
-- requires. The customer_code in the formatted number
-- (PORTAL-<code>-<seq>) is for operator legibility, not uniqueness, so
-- gaps in a given customer's numbering are expected and harmless.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS portal_order_seq AS BIGINT START WITH 1;

COMMIT;
