"""Unit tests for warehouse map pallet payload (Phase 1 — real data only)."""

import os
import sys

os.environ.setdefault("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
os.environ.setdefault("JWT_SECRET", "NEVER_USE_THIS_IN_PRODUCTION_32!")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.warehouse_map_service import _build_pallets_for_content


class TestBuildPalletsForContent:
    def test_returns_only_real_pallet_rows(self):
        rows = [
            {
                "item_id": 1,
                "sku": "SKU-A",
                "item_name": "Item A",
                "category": "Cat",
                "lot_number": "L1",
                "expiry_date": "2026-12-01",
                "pallet_id": 10,
                "pallet_code": "WH-PLT-00001",
                "pallet_barcode": "WH-PLT-00001",
                "quantity_on_hand": 5,
                "quantity_allocated": 1,
            },
            {
                "item_id": 2,
                "sku": "SKU-B",
                "item_name": "Item B",
                "category": "Cat",
                "lot_number": None,
                "expiry_date": None,
                "pallet_id": None,
                "pallet_code": None,
                "pallet_barcode": None,
                "quantity_on_hand": 12,
                "quantity_allocated": 0,
            },
        ]
        pallets = _build_pallets_for_content(99, rows)
        assert len(pallets) == 1
        assert pallets[0]["pallet_id"] == 10
        assert pallets[0]["is_synthetic"] is False
        assert pallets[0]["quantity_on_hand"] == 5

    def test_aggregates_same_pallet_id(self):
        rows = [
            {
                "item_id": 1, "sku": "SKU-A", "item_name": "A", "category": "C",
                "lot_number": None, "expiry_date": None,
                "pallet_id": 7, "pallet_code": "WH-PLT-00007", "pallet_barcode": None,
                "quantity_on_hand": 3, "quantity_allocated": 1,
            },
            {
                "item_id": 1, "sku": "SKU-A", "item_name": "A", "category": "C",
                "lot_number": None, "expiry_date": None,
                "pallet_id": 7, "pallet_code": "WH-PLT-00007", "pallet_barcode": None,
                "quantity_on_hand": 2, "quantity_allocated": 0,
            },
        ]
        pallets = _build_pallets_for_content(1, rows)
        assert len(pallets) == 1
        assert pallets[0]["quantity_on_hand"] == 5
        assert pallets[0]["quantity_allocated"] == 1

    def test_no_inventory_yields_empty_pallets(self):
        assert _build_pallets_for_content(1, []) == []
