"""Confine a customer-bound WMS token to its own tenant's data.

Migration 089 added ``wms_tokens.customer_id`` and said enforcement
lands in phase 6. This module is that enforcement for the inbound
(Pipe B) surface; the read side lives in routes/snapshot.py and the
surface gate in middleware/auth_middleware.py.

``customer_id IS NULL`` means an operator-owned token: unscoped, exactly
the pre-phase-6 behaviour. Every token issued before this change keeps
working unchanged -- the code paths below are inert unless a token
carries a customer binding.

Why the inbound surface needs more than a WHERE clause. A read can be
confined by filtering rows (that is what customer_scope_clause does for
the portal). A write cannot: the request *names* the entity it wants to
touch, so scoping means (a) refusing a payload that names another
customer, (b) stamping the owning-customer column server-side rather
than trusting the mapping to carry it, and (c) refusing to update a
canonical row that already belongs to someone else. All three are here.

Resource rules:

  sales_orders     stamp customer_ref
  purchase_orders  stamp owner_customer_id
  items            stamp owner_customer_id
  inventory_update ownership checked in routes/inbound.py (it resolves
                   an item rather than upserting one)
  customers        refused -- the customer master is the operator's
                   record of every tenant. A token that could write it
                   could rename or re-address another tenant, and a
                   create is by definition a customer other than the
                   caller.
  vendors          refused -- vendors are shared operator data with no
                   owning-customer column to confine a write to.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional, Set, Tuple

from sqlalchemy import text


# Canonical column carrying the owning customer, per inbound resource.
OWNER_COLUMN_BY_RESOURCE = {
    "sales_orders": "customer_ref",
    "purchase_orders": "owner_customer_id",
    "items": "owner_customer_id",
}

# Resources a customer-bound token may not write at all (see module docstring).
FORBIDDEN_RESOURCES = frozenset({"customers", "vendors"})

VIOLATION_KIND = "customer_scope_violation"
FORBIDDEN_KIND = "customer_scope_forbidden_resource"


@dataclass
class ScopeViolation:
    """A refusal to serialise as a 403. `error_kind` follows the inbound
    surface's convention (routes/inbound.py serialises HandlerError
    bodies with an error_kind key)."""

    error_kind: str
    message: str


def token_customer_id(token: Optional[Dict[str, Any]]) -> Optional[str]:
    """The customer a token is bound to, or None for an operator token."""
    if not token:
        return None
    value = token.get("customer_id")
    return str(value) if value else None


def enforce_inbound_scope(
    db,
    *,
    resource_key: str,
    canonical_type: str,
    canonical_table: str,
    source_system: str,
    external_id: str,
    canonical_payload: Dict[str, Any],
    write_field_set: Set[str],
    customer_id: str,
) -> Tuple[Optional[ScopeViolation], Set[str]]:
    """Apply the customer binding to one inbound upsert.

    Mutates ``canonical_payload`` (stamps the owning-customer column) and
    returns ``(violation_or_None, write_field_set)``. The field set is
    returned rather than mutated so the caller keeps its own value if the
    call refuses.
    """
    if resource_key in FORBIDDEN_RESOURCES:
        return (
            ScopeViolation(
                error_kind=FORBIDDEN_KIND,
                message=(
                    f"This token is bound to a single customer and cannot "
                    f"write the {resource_key!r} resource. Issue an "
                    f"operator token (customer_id unset) for master-data "
                    f"pushes."
                ),
            ),
            write_field_set,
        )

    owner_column = OWNER_COLUMN_BY_RESOURCE.get(resource_key)
    if owner_column is None:
        # Fail closed: a resource added later without a rule here would
        # otherwise be written unscoped by a customer-bound token.
        return (
            ScopeViolation(
                error_kind=FORBIDDEN_KIND,
                message=(
                    f"No customer-scoping rule for resource "
                    f"{resource_key!r}; refusing to write it from a "
                    f"customer-bound token."
                ),
            ),
            write_field_set,
        )

    # (a) The payload must not name a different customer. The mapping doc
    # is operator-authored but source_payload is not, so a mapped owner
    # value is caller-influenced input.
    incoming_owner = canonical_payload.get(owner_column)
    if incoming_owner and str(incoming_owner) != customer_id:
        return (
            ScopeViolation(
                error_kind=VIOLATION_KIND,
                message=(
                    f"{owner_column} names a different customer than this "
                    f"token is bound to."
                ),
            ),
            write_field_set,
        )

    # sales_orders also carries the legacy free-text customer code
    # (sales_orders.customer_id VARCHAR, kept for inbound mapping
    # compatibility -- mig 087 added customer_ref as the real FK). A code
    # that resolves to another tenant's customers row is the same attempt
    # by another route, so it is refused too. A code that resolves to
    # nothing is just a label and cannot leak anything.
    if canonical_table == "sales_orders":
        code = canonical_payload.get("customer_id")
        if code:
            row = db.execute(
                text(
                    "SELECT canonical_id FROM customers "
                    " WHERE customer_code = :code"
                ),
                {"code": str(code)},
            ).fetchone()
            if row is not None and str(row.canonical_id) != customer_id:
                return (
                    ScopeViolation(
                        error_kind=VIOLATION_KIND,
                        message=(
                            "customer_id names a different customer than "
                            "this token is bound to."
                        ),
                    ),
                    write_field_set,
                )

    # (c) An existing canonical row must not belong to someone else.
    # Reachable in principle when two customers' tokens share a
    # source_system, or when an operator re-attributed a row after the
    # customer's ERP first ingested it.
    existing_owner = _existing_owner(
        db,
        canonical_type=canonical_type,
        canonical_table=canonical_table,
        owner_column=owner_column,
        source_system=source_system,
        external_id=external_id,
    )
    if existing_owner is not None and existing_owner != customer_id:
        return (
            ScopeViolation(
                error_kind=VIOLATION_KIND,
                message=(
                    "The record this external_id maps to belongs to a "
                    "different customer."
                ),
            ),
            write_field_set,
        )

    # (b) Stamp the owner server-side. Adding the column to the write
    # field set is what makes _upsert_canonical include it on both the
    # INSERT and the UPDATE path.
    canonical_payload[owner_column] = customer_id
    return None, write_field_set | {owner_column}


def _existing_owner(
    db,
    *,
    canonical_type: str,
    canonical_table: str,
    owner_column: str,
    source_system: str,
    external_id: str,
) -> Optional[str]:
    """Owning customer of the canonical row this (source_system,
    external_id) already maps to, or None when there is no such row yet
    or it carries no owner.

    canonical_table and owner_column are interpolated into the SQL, so
    both come from the module-level constants above and never from
    request data -- same posture as inbound_service's f-string queries
    over _ResourceConfig.
    """
    row = db.execute(
        text(
            f"SELECT c.{owner_column} AS owner "
            f"  FROM cross_system_mappings csm "
            f"  JOIN {canonical_table} c ON c.external_id = csm.canonical_id "
            f" WHERE csm.source_system = :ss "
            f"   AND csm.source_type   = :st "
            f"   AND csm.source_id     = :sid"
        ),
        {"ss": source_system, "st": canonical_type, "sid": external_id},
    ).fetchone()
    if row is None or row.owner is None:
        return None
    return str(row.owner)
