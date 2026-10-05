"""Pure tests for services/dashboard_service helpers (no DB)."""
from datetime import date, datetime

from services import dashboard_service as svc

TODAY = date(2026, 3, 3)


def test_parse_days_default_and_valid():
    assert svc.parse_days(None, svc.OVERVIEW_DAYS) == (7, True)
    assert svc.parse_days("", svc.OVERVIEW_DAYS) == (7, True)
    assert svc.parse_days("30", svc.OVERVIEW_DAYS) == (30, True)
    assert svc.parse_days("90", svc.SALES_DAYS) == (90, True)


def test_parse_days_invalid():
    assert svc.parse_days("90", svc.OVERVIEW_DAYS) == (7, False)
    assert svc.parse_days("abc", svc.OVERVIEW_DAYS) == (7, False)
    assert svc.parse_days("-1", svc.SALES_DAYS) == (7, False)


def test_date_range_crosses_month_boundary():
    r = svc.date_range(7, TODAY)
    assert len(r) == 7
    assert r[0] == date(2026, 2, 25) and r[-1] == TODAY


def test_fill_series_gaps_and_order():
    out = svc.fill_series([(date(2026, 3, 1), 4), (datetime(2026, 3, 3, 10), 2)], 3, TODAY)
    assert out == [
        {"date": "2026-03-01", "value": 4},
        {"date": "2026-03-02", "value": 0},
        {"date": "2026-03-03", "value": 2},
    ]


def test_fill_series_ignores_out_of_range_and_sums_dupes():
    out = svc.fill_series([(date(2026, 1, 1), 9), (TODAY, 1), (TODAY, 2)], 2, TODAY)
    assert [p["value"] for p in out] == [0, 3]


def test_fill_series_numeric_and_none():
    out = svc.fill_series([(TODAY, None)], 1, TODAY, numeric=lambda v: round(float(v), 2))
    assert out == [{"date": "2026-03-03", "value": 0.0}]


def test_shape_counts_and_aov():
    assert svc.shape_counts([("OPEN", 3), ("SHIPPED", None)], "status") == [
        {"status": "OPEN", "count": 3}, {"status": "SHIPPED", "count": 0}]
    assert svc.avg_order_value(100, 3) == 33.33
    assert svc.avg_order_value(0, 0) == 0.0
