"""docs/api/portal-openapi.yaml covers every /api/portal route.

The inbound spec is generated from a builder and checked byte-for-byte
(test_inbound_openapi_parity.py). The portal spec is hand-written -- the
routes are few and the prose in it is the point -- so the check here is
narrower: every registered route and method must appear, and the spec
must not describe a route that no longer exists. That catches the
failure that actually happens, which is someone adding an endpoint to
routes/portal/ and forgetting the doc.
"""

import os
import re
import sys
from pathlib import Path

import pytest
import yaml

os.environ.setdefault("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
os.environ.setdefault("JWT_SECRET", "NEVER_USE_THIS_IN_PRODUCTION_32!")
os.environ.setdefault("SENTRY_ENCRYPTION_KEY", "t5hPIEVn_O41qfiMqAiPEnwzQh68o3Es46YfSOBvEK8=")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


_SPEC_CANDIDATES = [
    Path(__file__).resolve().parent.parent.parent / "docs" / "api"
        / "portal-openapi.yaml",
    Path("/docs/api/portal-openapi.yaml"),
]

_DOCUMENTED_METHODS = {"get", "post", "put", "patch", "delete"}


def _spec():
    for candidate in _SPEC_CANDIDATES:
        if candidate.is_file():
            return yaml.safe_load(candidate.read_text(encoding="utf-8"))
    pytest.skip(
        "docs/api/portal-openapi.yaml not accessible from this runner "
        "(docs/ is not mounted into the api container). Runs in CI where "
        "the full repo is on disk."
    )


def _flask_routes(app):
    """{(openapi-shaped path, lowercase method)} for /api/portal/*."""
    found = set()
    for rule in app.url_map.iter_rules():
        if not str(rule.rule).startswith("/api/portal"):
            continue
        # Flask "/orders/<so_number>" -> OpenAPI "/orders/{so_number}".
        path = re.sub(r"<(?:[^:<>]+:)?([^<>]+)>", r"{\1}", str(rule.rule))
        for method in rule.methods or ():
            if method.lower() in _DOCUMENTED_METHODS:
                found.add((path, method.lower()))
    return found


def _spec_operations(spec):
    return {
        (path, method)
        for path, item in (spec.get("paths") or {}).items()
        for method in item
        if method in _DOCUMENTED_METHODS
    }


class TestPortalOpenAPIParity:
    def test_every_route_is_documented(self, app):
        spec = _spec()
        missing = sorted(_flask_routes(app) - _spec_operations(spec))
        assert not missing, (
            f"routes/portal/ exposes operations absent from "
            f"docs/api/portal-openapi.yaml: {missing}"
        )

    def test_spec_documents_no_phantom_routes(self, app):
        spec = _spec()
        phantom = sorted(_spec_operations(spec) - _flask_routes(app))
        assert not phantom, (
            f"docs/api/portal-openapi.yaml documents operations that are "
            f"not registered: {phantom}"
        )

    def test_security_scheme_names_the_portal_cookie(self):
        """The staff cookie on a portal spec would send integrators down
        the wrong path -- and the two cookies exist precisely so the
        sessions stay apart."""
        spec = _spec()
        schemes = spec["components"]["securitySchemes"]
        assert schemes["PortalSession"]["name"] == "sentry_portal_auth"
        assert schemes["PortalCsrf"]["name"] == "X-CSRF-Token"
