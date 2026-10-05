# Admin endpoints for pallet-level tracking.
import math
import uuid

from flask import g, jsonify, request
from sqlalchemy import text

from middleware.auth_middleware import require_admin_or_page_permission, require_auth
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.pallets import AttachInventoryToPalletRequest, CreatePalletRequest, UpdatePalletRequest
from utils.validation import validate_body
from services.inventory_service import add_inventory
from services.pallet_service import (
    attach_bin_inventory_to_pallet,
    next_pallet_code as _next_pallet_code_for_wh,
)


def _next_pallet_code(warehouse_id: int) -> str | None:
    return _next_pallet_code_for_wh(g.db, warehouse_id)


@admin_bp.route('/pallets/next-code', methods=['GET'])
@require_auth
@require_admin_or_page_permission('pallets', 'warehouse-simulation')
@with_db
def next_pallet_code():
    warehouse_id = request.args.get('warehouse_id', type=int)
    if not warehouse_id:
        return jsonify({'error': 'warehouse_id is required'}), 400

    pallet_code = _next_pallet_code(warehouse_id)
    if not pallet_code:
        return jsonify({'error': 'Warehouse not found'}), 404
    return jsonify({'pallet_code': pallet_code})


@admin_bp.route('/pallets', methods=['GET'])
@require_auth
@require_admin_or_page_permission('pallets')
@with_db
def list_pallets():
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 50, type=int), 1000)
    warehouse_id = request.args.get('warehouse_id', type=int)
    item_id = request.args.get('item_id', type=int)
    where_clauses = []
    params = {}
    if warehouse_id:
        where_clauses.append('p.warehouse_id = :wid')
        params['wid'] = warehouse_id
    if item_id:
        where_clauses.append('p.item_id = :iid')
        params['iid'] = item_id
    where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''
    total = g.db.execute(text(f'SELECT COUNT(*) FROM pallets p {where_sql}'), params).scalar()
    pages = max(1, math.ceil(total / per_page))
    params['limit'] = per_page
    params['offset'] = (page - 1) * per_page
    rows = g.db.execute(
        text(f"SELECT p.pallet_id, p.pallet_code, p.pallet_barcode, p.item_id, i.sku, p.warehouse_id, p.bin_id, p.quantity, p.weight_kg, p.lot_code, p.expiry_date, p.status, p.created_at FROM pallets p LEFT JOIN items i ON i.item_id = p.item_id {where_sql} ORDER BY p.pallet_id LIMIT :limit OFFSET :offset"),
        params,
    ).fetchall()
    return jsonify({
        'pallets': [
            {'pallet_id': r.pallet_id, 'pallet_code': r.pallet_code, 'pallet_barcode': r.pallet_barcode, 'item_id': r.item_id, 'sku': r.sku, 'warehouse_id': r.warehouse_id, 'bin_id': r.bin_id, 'quantity': r.quantity, 'weight_kg': float(r.weight_kg) if r.weight_kg is not None else None, 'lot_code': r.lot_code, 'expiry_date': r.expiry_date.isoformat() if r.expiry_date else None, 'status': r.status, 'created_at': r.created_at.isoformat() if r.created_at else None}
            for r in rows
        ],
        'total': total, 'page': page, 'per_page': per_page, 'pages': pages,
    })


@admin_bp.route('/pallets/<int:pallet_id>', methods=['GET'])
@require_auth
@require_admin_or_page_permission('pallets')
@with_db
def get_pallet(pallet_id):
    r = g.db.execute(
        text('SELECT p.*, i.sku, i.item_name FROM pallets p LEFT JOIN items i ON i.item_id = p.item_id WHERE p.pallet_id = :pid'),
        {'pid': pallet_id},
    ).fetchone()
    if not r:
        return jsonify({'error': 'Pallet not found'}), 404
    return jsonify({
        'pallet': {
            'pallet_id': r.pallet_id, 'pallet_code': r.pallet_code, 'pallet_barcode': r.pallet_barcode,
            'item_id': r.item_id, 'sku': r.sku, 'item_name': r.item_name,
            'warehouse_id': r.warehouse_id, 'bin_id': r.bin_id, 'quantity': r.quantity,
            'weight_kg': float(r.weight_kg) if r.weight_kg is not None else None,
            'lot_code': r.lot_code, 'expiry_date': r.expiry_date.isoformat() if r.expiry_date else None,
            'status': r.status, 'created_at': r.created_at.isoformat() if r.created_at else None,
        }
    })


@admin_bp.route('/pallets', methods=['POST'])
@require_auth
@require_admin_or_page_permission('pallets', 'warehouse-simulation')
@validate_body(CreatePalletRequest)
@with_db
def create_pallet(validated):
    data = validated.model_dump()
    pallet_code = (data.get('pallet_code') or '').strip() or _next_pallet_code(data['warehouse_id'])
    if not pallet_code:
        return jsonify({'error': 'Warehouse not found'}), 404
    # ensure item exists
    if data.get('item_id'):
        item = g.db.execute(text('SELECT item_id FROM items WHERE item_id = :iid'), {'iid': data['item_id']}).fetchone()
        if not item:
            return jsonify({'error': 'Item not found'}), 404
    elif data.get('quantity', 0) > 0:
        return jsonify({'error': 'item_id is required when quantity is greater than zero'}), 400
    ext = str(uuid.uuid4())
    result = g.db.execute(
        text('INSERT INTO pallets (pallet_code, pallet_barcode, item_id, warehouse_id, bin_id, quantity, weight_kg, lot_code, expiry_date, customer_id, created_by, external_id) VALUES (:code, :barcode, :item_id, :wid, :bin_id, :qty, :weight, :lot, :expiry_date, :customer_id, :username, :ext) RETURNING pallet_id'),
        {
            'code': pallet_code, 'barcode': data.get('pallet_barcode') or pallet_code, 'item_id': data['item_id'],
            'wid': data['warehouse_id'], 'bin_id': data.get('bin_id'), 'qty': data.get('quantity', 0),
            'weight': float(data.get('weight_kg')) if data.get('weight_kg') is not None else None,
            'lot': data.get('lot_code'), 'expiry_date': data.get('expiry_date'),
            'customer_id': data.get('customer_id'),
            'username': g.current_user['username'], 'ext': ext,
        },
    )
    pallet_id = result.fetchone()[0]
    # if bin_id provided and quantity > 0, upsert inventory referencing pallet
    if data.get('item_id') and data.get('bin_id') and data.get('quantity', 0) > 0:
        add_inventory(
            g.db, data['item_id'], data['bin_id'], data['warehouse_id'],
            data['quantity'], data.get('lot_code'), pallet_id=pallet_id,
            expiry_date=data.get('expiry_date'),
        )
    g.db.commit()
    return jsonify({
        'pallet_id': pallet_id,
        'pallet_code': pallet_code,
        'pallet_barcode': data.get('pallet_barcode') or pallet_code,
        'external_id': ext,
    }), 201


@admin_bp.route('/pallets/<int:pallet_id>/attach-inventory', methods=['POST'])
@require_auth
@require_admin_or_page_permission('pallets', 'warehouse-simulation')
@validate_body(AttachInventoryToPalletRequest)
@with_db
def attach_inventory_to_pallet(pallet_id, validated):
    """Move unpalletized bin stock onto an existing LPN."""
    data = validated.model_dump()
    try:
        result = attach_bin_inventory_to_pallet(
            g.db,
            pallet_id=pallet_id,
            item_id=data['item_id'],
            bin_id=data['bin_id'],
            lot_number=data.get('lot_number'),
            quantity=data.get('quantity'),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        g.db.rollback()
        return jsonify({'error': str(exc) or 'Attach pallet failed'}), 500
    g.db.commit()
    return jsonify(result), 200


@admin_bp.route('/pallets/<int:pallet_id>/move', methods=['POST'])
@require_auth
@require_admin_or_page_permission('pallets')
@with_db
def move_pallet(pallet_id):
    """Move pallet to another bin. Body: { to_bin_id: int }"""
    body = request.get_json() or {}
    to_bin = body.get('to_bin_id')
    if not to_bin:
        return jsonify({'error': 'to_bin_id required'}), 400
    p = g.db.execute(text('SELECT pallet_id, item_id, warehouse_id, bin_id FROM pallets WHERE pallet_id = :pid'), {'pid': pallet_id}).fetchone()
    if not p:
        return jsonify({'error': 'Pallet not found'}), 404
    # update pallet bin
    g.db.execute(text('UPDATE pallets SET bin_id = :to_bin, updated_at = NOW() WHERE pallet_id = :pid'), {'to_bin': to_bin, 'pid': pallet_id})
    # move inventory rows referencing pallet_id to new bin
    g.db.execute(text('UPDATE inventory SET bin_id = :to_bin, warehouse_id = (SELECT warehouse_id FROM bins WHERE bin_id = :to_bin) WHERE pallet_id = :pid'), {'to_bin': to_bin, 'pid': pallet_id})
    g.db.commit()
    return jsonify({'message': 'moved', 'to_bin_id': to_bin})


@admin_bp.route('/pallets/<int:pallet_id>/ship', methods=['POST'])
@require_auth
@require_admin_or_page_permission('pallets')
@with_db
def ship_pallet(pallet_id):
    """Mark pallet shipped (IN_TRANSIT) and optionally record vehicle movement. Body: { vehicle_plate, driver_name }"""
    body = request.get_json() or {}
    vehicle_plate = body.get('vehicle_plate')
    driver_name = body.get('driver_name')
    p = g.db.execute(text('SELECT pallet_id, item_id, warehouse_id, bin_id, customer_id FROM pallets WHERE pallet_id = :pid'), {'pid': pallet_id}).fetchone()
    if not p:
        return jsonify({'error': 'Pallet not found'}), 404
    g.db.execute(text('UPDATE pallets SET status = :st, updated_at = NOW() WHERE pallet_id = :pid'), {'st': 'IN_TRANSIT', 'pid': pallet_id})
    # record vehicle movement if provided
    if vehicle_plate:
        g.db.execute(text('INSERT INTO vehicle_movements (movement_type, vehicle_plate, driver_name, reference_type, reference_id, related_pallet_id, recorded_by, recorded_at) VALUES (:mt, :plate, :driver, :rt, :rid, :pallet, :user, NOW())'), {'mt': 'OUTBOUND', 'plate': vehicle_plate, 'driver': driver_name, 'rt': 'PALLET', 'rid': pallet_id, 'pallet': pallet_id, 'user': g.current_user['username']})
    # create billing event OUTBOUND if pallet has customer
    if p.customer_id:
        from services.billing_service import create_billing_event as svc_create_billing_event
        svc_create_billing_event(g.db, p.customer_id, p.warehouse_id, 'OUTBOUND', 'PALLET', pallet_id, 1)
    g.db.commit()
    return jsonify({'message': 'shipped'}), 200


@admin_bp.route('/pallets/<int:pallet_id>', methods=['PUT'])
@require_auth
@require_admin_or_page_permission('pallets')
@validate_body(UpdatePalletRequest)
@with_db
def update_pallet(pallet_id, validated):
    data = validated.model_dump(exclude_unset=True)
    existing = g.db.execute(text('SELECT pallet_id FROM pallets WHERE pallet_id = :pid'), {'pid': pallet_id}).fetchone()
    if not existing:
        return jsonify({'error': 'Pallet not found'}), 404
    fields, params = [], {'pid': pallet_id}
    for col in ('pallet_barcode', 'bin_id', 'quantity', 'weight_kg', 'status', 'lot_code', 'expiry_date'):
        if col in data:
            fields.append(f'{col} = :{col}')
            params[col] = data[col]
    if not fields:
        return jsonify({'error': 'No valid fields provided'}), 400
    fields.append('updated_at = NOW()')
    g.db.execute(text(f'UPDATE pallets SET {', '.join(fields)} WHERE pallet_id = :pid'), params)
    g.db.commit()
    return jsonify({'message': 'updated'})

