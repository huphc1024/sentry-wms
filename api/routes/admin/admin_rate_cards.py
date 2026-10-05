"""Admin CRUD for rate cards."""
import math
import uuid

from flask import g, jsonify, request
from sqlalchemy import text

from middleware.auth_middleware import require_admin_or_page_permission, require_auth
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.rate_cards import CreateRateCardRequest, UpdateRateCardRequest
from utils.validation import validate_body


@admin_bp.route('/rate-cards', methods=['GET'])
@require_auth
@require_admin_or_page_permission('billing')
@with_db
def list_rate_cards():
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 50, type=int), 1000)
    where_clauses = []
    params = {}
    customer_id = request.args.get('customer_id')
    if customer_id:
        where_clauses.append('rc.customer_id = :cid')
        params['cid'] = customer_id
    where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''
    total = g.db.execute(text(f'SELECT COUNT(*) FROM billing_rate_cards rc {where_sql}'), params).scalar()
    pages = max(1, math.ceil(total / per_page))
    params['limit'] = per_page
    params['offset'] = (page - 1) * per_page
    rows = g.db.execute(
        text(f"""
            SELECT rc.rate_card_id, rc.customer_id, rc.contract_id,
                   rc.warehouse_id, rc.rate_name, rc.service_type, rc.unit,
                   rc.unit_price, rc.currency, rc.effective_from, rc.effective_to,
                   c.customer_code, c.customer_name, cc.contract_number
            FROM billing_rate_cards rc
            LEFT JOIN customers c ON c.canonical_id = rc.customer_id
            LEFT JOIN customer_contracts cc ON cc.contract_id = rc.contract_id
            {where_sql}
            ORDER BY rc.rate_card_id DESC LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()
    return jsonify({
        'rate_cards': [
            {'rate_card_id': r.rate_card_id, 'customer_id': str(r.customer_id) if r.customer_id else None,
             'customer_code': r.customer_code, 'customer_name': r.customer_name,
             'contract_id': r.contract_id, 'contract_number': r.contract_number,
             'warehouse_id': r.warehouse_id, 'rate_name': r.rate_name,
             'service_type': r.service_type, 'unit': r.unit,
             'unit_price': float(r.unit_price), 'currency': r.currency,
             'effective_from': r.effective_from.isoformat() if r.effective_from else None,
             'effective_to': r.effective_to.isoformat() if r.effective_to else None}
            for r in rows
        ],
        'total': total, 'page': page, 'per_page': per_page, 'pages': pages,
    })


@admin_bp.route('/rate-cards', methods=['POST'])
@require_auth
@require_admin_or_page_permission('billing')
@validate_body(CreateRateCardRequest)
@with_db
def create_rate_card(validated):
    data = validated.model_dump()
    ext = str(uuid.uuid4())
    g.db.execute(
        text("""INSERT INTO billing_rate_cards (
            customer_id, contract_id, warehouse_id, rate_name, service_type,
            unit, unit_price, currency, effective_from, effective_to,
            created_at, external_id
        ) VALUES (
            :cid, :contract_id, :warehouse_id, :rate_name, :stype,
            :unit, :price, :cur, :ef, :et, NOW(), :ext
        )"""),
        {
            'cid': data.get('customer_id'), 'contract_id': data.get('contract_id'),
            'warehouse_id': data.get('warehouse_id'), 'rate_name': data.get('rate_name'),
            'stype': data['service_type'], 'unit': data['unit'],
            'price': float(data['unit_price']), 'cur': data.get('currency') or 'VND', 'ef': data.get('effective_from'), 'et': data.get('effective_to'), 'ext': ext
        },
    )
    g.db.commit()
    return jsonify({'message': 'created', 'external_id': ext}), 201


@admin_bp.route('/rate-cards/<int:rate_card_id>', methods=['PUT'])
@require_auth
@require_admin_or_page_permission('billing')
@validate_body(UpdateRateCardRequest)
@with_db
def update_rate_card(rate_card_id, validated):
    data = validated.model_dump(exclude_unset=True)
    existing = g.db.execute(text('SELECT rate_card_id FROM billing_rate_cards WHERE rate_card_id = :rid'), {'rid': rate_card_id}).fetchone()
    if not existing:
        return jsonify({'error': 'Rate card not found'}), 404
    fields, params = [], {'rid': rate_card_id}
    for col in ('contract_id', 'warehouse_id', 'rate_name', 'service_type', 'unit', 'unit_price', 'currency', 'effective_from', 'effective_to'):
        if col in data:
            fields.append(f"{col} = :{col}")
            params[col] = data[col]
    if not fields:
        return jsonify({'error': 'No valid fields provided'}), 400
    g.db.execute(text(f"UPDATE billing_rate_cards SET {', '.join(fields)} WHERE rate_card_id = :rid"), params)
    g.db.commit()
    return jsonify({'message': 'updated'})


@admin_bp.route('/rate-cards/<int:rate_card_id>', methods=['DELETE'])
@require_auth
@require_admin_or_page_permission('billing')
@with_db
def delete_rate_card(rate_card_id):
    existing = g.db.execute(text('SELECT rate_card_id FROM billing_rate_cards WHERE rate_card_id = :rid'), {'rid': rate_card_id}).fetchone()
    if not existing:
        return jsonify({'error': 'Rate card not found'}), 404
    g.db.execute(text('DELETE FROM billing_rate_cards WHERE rate_card_id = :rid'), {'rid': rate_card_id})
    g.db.commit()
    return jsonify({'message': 'deleted'})

