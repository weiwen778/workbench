import pytest

from app.models import DataRecord, Dashboard, User
from app.security import hash_password
from app.services import dashboard as service


def source(auth, name='运营日报'):
    response = auth.post('/api/v1/tables', json={'name': name, 'fields': [
        {'name': '店铺', 'type': 'short_text'}, {'name': '日期', 'type': 'date'},
        {'name': '销售额', 'type': 'number'},
        {'name': '状态', 'type': 'select', 'options': [{'id': 'done', 'name': '完成'}, {'id': 'pending', 'name': '待处理'}]},
        {'name': '已核对', 'type': 'checkbox'},
    ]})
    assert response.status_code == 201, response.text
    table = response.json()
    return table, {f['name']: f['key'] for f in table['fields']}


def add(auth, table, keys, **values):
    response = auth.post(f"/api/v1/tables/{table['id']}/records", json={'data': {keys[k]: v for k, v in values.items()}})
    assert response.status_code == 201, response.text
    return response.json()


def board(auth, widgets=None):
    response = auth.post('/api/v1/dashboards', json={'name': '经营总览'})
    assert response.status_code == 201, response.text
    out = response.json()
    if widgets is not None:
        response = auth.put(f"/api/v1/dashboards/{out['id']}", json={'name': out['name'], 'version': out['version'], 'widgets': widgets})
        assert response.status_code == 200, response.text
        out = response.json()
    return out


def widget(table, keys, **extra):
    return {'id': 'w1', 'title': '销售额', 'table_id': table['id'], 'aggregation': 'sum',
            'value_field': keys['销售额'], 'date_field': keys['日期'], **extra}


def data(auth, b, **params):
    response = auth.get(f"/api/v1/dashboards/{b['id']}/data", params=params)
    assert response.status_code == 200, response.text
    return response.json()['widgets']


def test_full_table_aggregation_not_current_page_and_exact_decimals(auth, db):
    table, keys = source(auth)
    db.add_all([DataRecord(table_id=table['id'], data={keys['销售额']: '0.1', keys['店铺']: 'A'}) for _ in range(121)])
    db.commit()
    b = board(auth, [widget(table, keys)])
    result = data(auth, b)[0]
    assert result['value'] == '12.1'
    assert result['matched_rows'] == 121
    page = auth.get(f"/api/v1/tables/{table['id']}/records?page_size=50").json()
    assert len(page['items']) == 50


@pytest.mark.parametrize(('aggregation', 'expected'), [('count', '4'), ('sum', '8'), ('avg', None), ('min', '-2'), ('max', '10')])
def test_aggregations_zero_negative_and_empty(auth, db, aggregation, expected):
    table, keys = source(auth)
    for amount in ('0', '-2', '10'):
        add(auth, table, keys, 销售额=amount)
    # 空行现在不允许通过接口创建；这里直接落一条空记录，验证汇总会忽略它。
    db.add(DataRecord(table_id=table['id'], data={keys['销售额']: None}))
    db.commit()
    b = board(auth, [widget(table, keys, aggregation=aggregation)])
    result = data(auth, b)[0]
    if aggregation == 'avg':
        assert abs(float(result['value']) - 8 / 3) < 1e-12
    else:
        assert result['value'] == expected
    assert result['ignored_rows'] == (0 if aggregation == 'count' else 1)


def test_date_range_inclusive_missing_dates_and_unfiltered_widgets(auth):
    table, keys = source(auth)
    for day, amount in [('2026-10-01', '1'), ('2026-10-02', '2'), ('2026-10-03', '3'), (None, '4')]:
        add(auth, table, keys, 日期=day, 销售额=amount)
    b = board(auth, [widget(table, keys), widget(table, keys, id='all', date_field=None)])
    results = data(auth, b, start_date='2026-10-01', end_date='2026-10-02')
    assert results[0]['value'] == '3' and results[0]['matched_rows'] == 2
    assert results[0]['date_filter_applied'] is True
    assert results[1]['value'] == '10' and results[1]['date_filter_unavailable'] is True
    assert auth.get(f"/api/v1/dashboards/{b['id']}/data?start_date=bad").status_code == 422
    assert auth.get(f"/api/v1/dashboards/{b['id']}/data?start_date=2026-11-01&end_date=2026-10-01").status_code == 422


def test_groups_option_labels_checkbox_and_pie_other(auth):
    table, keys = source(auth)
    for shop, amount, state, checked in [('A', '10', 'done', True), ('B', '5', 'pending', False), ('C', '1', 'done', None)]:
        add(auth, table, keys, 店铺=shop, 销售额=amount, 状态=state, 已核对=checked)
    b = board(auth, [
        widget(table, keys, kind='bar', group_field=keys['状态']),
        widget(table, keys, id='pie', kind='pie', group_field=keys['店铺'], limit=1),
        widget(table, keys, id='checks', kind='bar', group_field=keys['已核对'], aggregation='count'),
    ])
    results = data(auth, b)
    assert results[0]['points'] == [{'label': '完成', 'value': '11', 'rows': 2}, {'label': '待处理', 'value': '5', 'rows': 1}]
    assert results[1]['points'][1] == {'label': '其他（剩余分组）', 'value': '6', 'rows': 2}
    assert {p['label'] for p in results[2]['points']} == {'是', '否', '(未填写)'}


def test_date_trends_week_and_month_and_recent_limit(auth):
    table, keys = source(auth)
    for day, amount in [('2026-10-31', '1'), ('2026-10-26', '2'), ('2026-11-01', '3'), ('2026-11-02', '4')]:
        add(auth, table, keys, 日期=day, 销售额=amount)
    b = board(auth, [
        widget(table, keys, kind='line', group_field=keys['日期'], date_bucket='week'),
        widget(table, keys, id='months', kind='bar', group_field=keys['日期'], date_bucket='month', sort='label_asc'),
        widget(table, keys, id='recent', kind='line', group_field=keys['日期'], limit=2),
        # 柱状图未显式设置排序时，日期分组也应按时间升序并取最近两组。
        widget(table, keys, id='bar_recent', kind='bar', group_field=keys['日期'], limit=2),
    ])
    results = data(auth, b)
    assert [(p['label'], p['value']) for p in results[0]['points']] == [('2026-10-26', '6'), ('2026-11-02', '4')]
    assert [(p['label'], p['value']) for p in results[1]['points']] == [('2026-10', '3'), ('2026-11', '7')]
    assert [p['label'] for p in results[2]['points']] == ['2026-11-01', '2026-11-02']
    assert [p['label'] for p in results[3]['points']] == ['2026-11-01', '2026-11-02']


def test_bar_date_group_defaults_to_chronological_and_recent_limit(auth):
    table, keys = source(auth)
    for day, amount in [('2026-10-01', '100'), ('2026-10-02', '1'), ('2026-10-03', '2')]:
        add(auth, table, keys, 日期=day, 销售额=amount)
    b = board(auth, [widget(table, keys, kind='bar', group_field=keys['日期'], limit=2)])
    result = data(auth, b)[0]
    assert [p['label'] for p in result['points']] == ['2026-10-02', '2026-10-03']


def test_edits_and_deleted_records_reflected_live(auth):
    table, keys = source(auth)
    record = add(auth, table, keys, 销售额='10')
    b = board(auth, [widget(table, keys)])
    assert data(auth, b)[0]['value'] == '10'
    auth.put(f"/api/v1/records/{record['id']}", json={'version': record['version'], 'data': {keys['销售额']: '20'}})
    assert data(auth, b)[0]['value'] == '20'
    auth.delete(f"/api/v1/records/{record['id']}")
    assert data(auth, b)[0]['matched_rows'] == 0


def test_missing_source_isolated_and_broken_card_can_be_removed(auth):
    table, keys = source(auth)
    other, otherkeys = source(auth, '另一个来源')
    b = board(auth, [widget(table, keys), widget(other, otherkeys, id='other')])
    auth.delete(f"/api/v1/tables/{table['id']}")
    results = data(auth, b)
    assert results[0]['status'] == 'error' and '删除' in results[0]['message']
    assert results[1]['status'] == 'ok'
    response = auth.put(f"/api/v1/dashboards/{b['id']}", json={**b, 'name': '重命名仍可用'})
    assert response.status_code == 200
    updated = response.json()
    response = auth.put(f"/api/v1/dashboards/{b['id']}", json={**updated, 'widgets': [updated['widgets'][1]]})
    assert response.status_code == 200


def test_deleted_or_changed_column_reports_configuration_error(auth):
    table, keys = source(auth)
    b = board(auth, [widget(table, keys)])
    field_id = next(f['id'] for f in table['fields'] if f['key'] == keys['销售额'])
    response = auth.delete(f'/api/v1/fields/{field_id}?confirm=true')
    assert response.status_code == 200, response.text
    result = data(auth, b)[0]
    assert result['status'] == 'error' and '统计列' in result['message']


def test_version_conflict_delete_and_account_isolation(auth, db):
    b = board(auth)
    response = auth.put(f"/api/v1/dashboards/{b['id']}", json={**b, 'name': '最新名称'})
    assert response.status_code == 200
    assert auth.put(f"/api/v1/dashboards/{b['id']}", json=b).status_code == 409
    assert auth.delete(f"/api/v1/dashboards/{b['id']}?version=1").status_code == 409
    other = User(username='another', password_hash=hash_password('testpassword'))
    db.add(other); db.flush()
    otherboard = Dashboard(user_id=other.id, name='私有', widgets=[], version=1)
    db.add(otherboard); db.commit()
    assert auth.get(f'/api/v1/dashboards/{otherboard.id}/data').status_code == 404
    assert len(auth.get('/api/v1/dashboards').json()) == 1
    assert auth.delete(f"/api/v1/dashboards/{b['id']}?version=2").status_code == 200


@pytest.mark.parametrize('extra', [
    {'aggregation': 'sum', 'value_field': 'missing'},
    {'kind': 'bar', 'group_field': 'missing'}, {'date_field': 'missing'},
    {'kind': 'pie', 'aggregation': 'avg'}, {'limit': 31}, {'title': '   '},
])
def test_invalid_configuration_rejected(auth, extra):
    table, keys = source(auth)
    response = auth.post('/api/v1/dashboards/preview', json={'widget': widget(table, keys, **extra)})
    assert response.status_code == 422, response.text


def test_preview_does_not_save_and_duplicate_ids_rejected(auth):
    table, keys = source(auth)
    add(auth, table, keys, 销售额='10')
    config = widget(table, keys)
    response = auth.post('/api/v1/dashboards/preview', json={'widget': config})
    assert response.status_code == 200 and response.json()['value'] == '10'
    assert auth.get('/api/v1/dashboards').json() == []
    b = board(auth)
    assert auth.put(f"/api/v1/dashboards/{b['id']}", json={**b, 'widgets': [config, config]}).status_code == 422
    assert auth.post('/api/v1/dashboards', json={'name': '  '}).status_code == 422


def test_limits_report_error_instead_of_partial_totals(auth, monkeypatch):
    table, keys = source(auth)
    for shop in ('A', 'B', 'C'):
        add(auth, table, keys, 店铺=shop, 销售额='1')
    b = board(auth, [widget(table, keys, kind='bar', group_field=keys['店铺'])])
    monkeypatch.setattr(service, 'MAX_ROWS', 2)
    assert data(auth, b)[0]['status'] == 'error'
    monkeypatch.setattr(service, 'MAX_ROWS', 100)
    monkeypatch.setattr(service, 'MAX_GROUPS', 2)
    assert data(auth, b)[0]['status'] == 'error'


def test_dashboard_requires_browser_login(client):
    assert client.get('/api/v1/dashboards').status_code == 401
    assert client.post('/api/v1/dashboards', json={'name': '禁止'}).status_code == 401
