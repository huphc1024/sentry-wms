"""Customer portal API (phase 3).

Two blueprints, mounted separately in app.py:

  portal_auth_bp  -> /api/portal/auth   (login / logout / me / change-password)
  portal_bp       -> /api/portal        (the customer's own data)

Every route on portal_bp carries @require_customer_auth, which rejects
staff tokens, plus @require_customer_feature for the matching feature
grant. Reads filter in SQL via customer_scope_clause rather than checking
ownership after fetching: that keeps "no such order" and "someone else's
order" indistinguishable (both 404), so the endpoints are not an
existence oracle over other customers' order numbers and SKUs. Same
V-026 reasoning as warehouse_scope_clause on the staff side.

Aggregation follows routes/admin/__init__.py: the blueprint is declared
here and sub-modules import it, with the sub-module imports at the bottom
of this file so registering a route is a one-line change.
"""

from flask import Blueprint, request

portal_bp = Blueprint("portal", __name__)

# Paging shared by every list endpoint. Lives here rather than in one of
# the sub-modules so the others do not have to import a private helper
# out of a sibling -- the same coupling that made the portal login reach
# into routes.auth for its rate-limit helpers.
#
# MAX_PAGE_SIZE is a ceiling, not a default: without it a customer with a
# large catalogue could pull its entire item master in one request.
MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


def paging():
    """Return (page, page_size, offset) from the query string.

    Unparseable values fall back to the defaults rather than 400: these
    are list endpoints where a bad ?page= is far more likely to be a
    stale bookmark than an attack, and failing the whole request would
    just show the customer an error instead of the first page.
    """
    try:
        page = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = int(request.args.get("page_size", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        size = DEFAULT_PAGE_SIZE
    size = max(1, min(size, MAX_PAGE_SIZE))
    return page, size, (page - 1) * size


from routes.portal.portal_auth import portal_auth_bp  # noqa: E402,F401
from routes.portal import (  # noqa: E402,F401
    portal_billing,
    portal_inventory,
    portal_orders,
)
