"""自然语言生成看板图表配置。模型输出只作为候选，必须校验后才允许保存。"""
from __future__ import annotations

import json
import re
import time
import uuid

import httpx

from ..errors import ApiError

MODEL = 'glm-4-flash'
KINDS = {'metric', 'bar', 'line', 'pie'}
AGGREGATIONS = {'count', 'sum', 'avg', 'min', 'max'}
NUMERIC_TYPES = {'number', 'formula', 'rollup'}
DIMENSION_TYPES = {'short_text', 'long_text', 'select', 'checkbox', 'date'}
MAX_WIDGETS = 4


def _json(text: str):
    cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', (text or '').strip(), flags=re.I)
    try:
        data = json.loads(cleaned)
    except (ValueError, TypeError):
        raise ApiError('AI_OUTPUT_INVALID', '模型没有返回有效的配置，请换个说法再试', 502)
    if isinstance(data, dict):
        data = data.get('widgets') or data.get('charts') or [data]
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict) and ('widgets' in data[0] or 'charts' in data[0]):
        data = data[0].get('widgets') or data[0].get('charts') or []
    if not isinstance(data, list):
        raise ApiError('AI_OUTPUT_INVALID', '模型返回的配置结构不支持，请重试', 502)
    return data[:MAX_WIDGETS]


def _text(value, limit=100):
    return str(value or '').strip()[:limit]


def _norm(value):
    return re.sub(r'[\s:：_\-（）()]', '', str(value or '')).casefold()


ALIASES = [
    {'电话', '手机', '手机号', '手机号码', '联系电话', '联系方式', 'phone', 'tel'},
    {'邮件', '邮箱', '电子邮件', 'email', 'e-mail'},
    {'名字', '姓名', 'name'},
    {'地址', '住址', '联系地址', 'address'},
    {'日期', '时间', '创建日期', '创建时间', 'date', 'created_at'},
]


def _resolve(value, fields, types=None):
    """模型可能返回字段名而不是 key，这里统一解析成 key。"""
    if value is None:
        return None
    raw = str(value).strip()
    if raw in fields and (types is None or fields[raw]['type'] in types):
        return raw
    normal = _norm(raw)
    for key, field in fields.items():
        if types is not None and field['type'] not in types:
            continue
        if normal == _norm(field['name']):
            return key
    for group in ALIASES:
        if normal in {_norm(alias) for alias in group}:
            hits = [key for key, field in fields.items()
                    if (types is None or field['type'] in types) and _norm(field['name']) in {_norm(alias) for alias in group}]
            if len(hits) == 1:
                return hits[0]
    return None


TREND_WORDS = ('每天', '每日', '逐日', '按天', '每周', '按周', '每月', '按月', '趋势', '走势', '变化')
PIE_WORDS = ('占比', '比例', '构成', '分布', '百分比')
AVG_WORDS = ('平均', '均值')


def _prompt_fields(prompt, fields, types):
    """找出用户在描述里直接点名的字段，按出现位置排序。"""
    text = _norm(prompt)
    hits = {}
    for key, field in fields.items():
        if types is not None and field['type'] not in types:
            continue
        name = _norm(field['name'])
        index = text.find(name) if name else -1
        if index >= 0:
            hits[key] = min(hits.get(key, index), index)
    for group in ALIASES:
        aliases = {_norm(alias) for alias in group}
        index = min((text.find(alias) for alias in aliases if text.find(alias) >= 0), default=-1)
        if index < 0:
            continue
        for key, field in fields.items():
            if types is not None and field['type'] not in types:
                continue
            if _norm(field['name']) in aliases:
                hits[key] = min(hits.get(key, index), index)
    return [key for key, _ in sorted(hits.items(), key=lambda item: item[1])]


def _prompt_context(prompt, fields):
    text = _norm(prompt)
    trend = any(word in text for word in TREND_WORDS)
    bucket = 'month' if any(word in text for word in ('每月', '按月')) else 'week' if any(word in text for word in ('每周', '按周')) else 'day'
    return {
        'trend': trend,
        'bucket': bucket,
        'pie': any(word in text for word in PIE_WORDS),
        'avg': any(word in text for word in AVG_WORDS),
        'dims': _prompt_fields(prompt, fields, DIMENSION_TYPES),
        'values': _prompt_fields(prompt, fields, NUMERIC_TYPES),
        'dates': _prompt_fields(prompt, fields, {'date'}),
    }


def _int(value, default, low, high):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def normalize(raw_items, tables, prompt=''):
    """把模型输出收敛到 Widget 允许的字段和值，丢弃不可用配置。"""
    widgets, warnings = [], []
    single = len(raw_items) == 1
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            warnings.append(f'第 {index + 1} 个配置格式不正确，已跳过')
            continue
        try:
            table_id = int(raw.get('table_id') or 0)
        except (TypeError, ValueError):
            table_id = 0
        if table_id not in tables:
            wanted = raw.get('table_name') or raw.get('table') or raw.get('table_id')
            if isinstance(wanted, str):
                table_id = next((key for key, value in tables.items() if _norm(value['name']) == _norm(wanted)), 0)
        if table_id not in tables:
            warnings.append(f'第 {index + 1} 个配置引用了不存在的表格，已跳过')
            continue
        table = tables[table_id]
        fields = table['fields']
        numeric = [key for key, field in fields.items() if field['type'] in NUMERIC_TYPES]
        dimensions = [key for key, field in fields.items() if field['type'] in DIMENSION_TYPES]
        dates = [key for key, field in fields.items() if field['type'] == 'date']
        if not dimensions and not numeric:
            warnings.append(f'表格「{table["name"]}」没有可用于图表的字段')
            continue

        kind = raw.get('kind') if raw.get('kind') in KINDS else 'metric'
        aggregation = raw.get('aggregation') if raw.get('aggregation') in AGGREGATIONS else 'count'

        requested_values = raw.get('value_fields')
        if not isinstance(requested_values, list):
            requested_values = [raw.get('value_field')] if raw.get('value_field') else []
        value_fields = []
        for value in requested_values:
            key = _resolve(value, fields, NUMERIC_TYPES)
            if key and key not in value_fields:
                value_fields.append(key)
                if len(value_fields) >= 8:
                    break

        value_field = _resolve(raw.get('value_field'), fields, NUMERIC_TYPES)
        if kind in {'bar', 'line'}:
            if aggregation == 'count':
                value_fields = []
            else:
                if not value_fields and value_field:
                    value_fields = [value_field]
                if not value_fields and numeric:
                    value_fields = [numeric[0]]
                if not value_fields:
                    aggregation = 'count'
            value_field = value_fields[0] if value_fields else None
        elif kind == 'pie':
            value_fields = []
            if aggregation not in {'count', 'sum'}:
                aggregation = 'count'
            if aggregation == 'sum' and not value_field:
                value_field = numeric[0] if numeric else None
                if not value_field:
                    aggregation = 'count'
        else:  # metric
            value_fields = []
            if aggregation != 'count':
                value_field = value_field or (numeric[0] if numeric else None)
                if not value_field:
                    aggregation = 'count'
            else:
                value_field = None

        group_field = _resolve(raw.get('group_field'), fields, DIMENSION_TYPES)
        date_field = _resolve(raw.get('date_field'), fields, {'date'})
        if kind != 'metric' and not group_field:
            group_field = (dates[0] if kind == 'line' and dates else (dimensions[0] if dimensions else None))
        if kind != 'metric' and not group_field:
            kind, aggregation, value_field, value_fields = 'metric', 'count', None, []
            warnings.append(f'第 {index + 1} 个配置缺少可分组字段，已改为数字卡片')

        if kind == 'line' and group_field in dates:
            date_field = date_field or group_field

        bucket = raw.get('date_bucket')
        if bucket not in {'day', 'week', 'month'}:
            bucket = 'month' if kind == 'line' and group_field in dates else 'day'

        # 用户描述里直接点名的字段/意图，优先于模型的模糊选择。
        reason_text = _norm(f"{raw.get('title', '')} {raw.get('reason', '')}")
        context = _prompt_context(prompt, fields)
        trend_intent = bool(context['trend'] and (
            single or any(word in reason_text for word in ('趋势', '走势', '每天', '每周', '每月', '日期')) or raw.get('kind') == 'line'
        ))
        if trend_intent and dates:
            kind = 'line'
            group_field = context['dates'][0] if context['dates'] else dates[0]
            date_field = group_field
            bucket = context['bucket']
        elif context['dims'] and kind != 'metric':
            group_field = context['dims'][0]

        if context['pie'] and kind != 'metric' and group_field and (
            single or any(word in reason_text for word in ('占比', '比例', '构成', '分布'))
        ):
            kind = 'pie'

        avg_intent = bool(context['avg'] and (
            single or '平均' in _norm(raw.get('title', '')) or raw.get('aggregation') == 'avg'
        ))
        if avg_intent and numeric:
            chosen = context['values'][0] if context['values'] else (value_field or numeric[0])
            aggregation = 'avg'
            value_field = chosen
            value_fields = [chosen] if kind in {'bar', 'line'} else []
            if kind == 'metric' and (group_field or context['dims']):
                kind = 'bar'
                group_field = group_field or (context['dims'][0] if context['dims'] else None)
        elif context['values'] and numeric and (
            single or any(_norm(_field_name(fields, key)) in _norm(raw.get('title', '')) for key in context['values'])
            or raw.get('aggregation') in {'sum', 'avg', 'min', 'max'}
        ):
            chosen = context['values'][0]
            if kind in {'metric', 'bar', 'line'} and aggregation == 'count':
                aggregation = 'sum'
            value_field = chosen
            if kind in {'bar', 'line'}:
                value_fields = [chosen]
            if kind == 'metric' and (group_field or context['dims']):
                kind = 'bar'
                group_field = group_field or (context['dims'][0] if context['dims'] else None)

        if context['dims'] and kind == 'metric':
            kind = 'bar'
            group_field = context['dims'][0]
        if kind == 'line' and not trend_intent and group_field not in dates:
            kind = 'bar'
        if kind == 'pie':
            if aggregation not in {'count', 'sum'}:
                aggregation = 'count'
            value_fields = []

        title = _text(raw.get('title'), 40) or f'{table["name"]} · {_field_name(fields, value_field or group_field) or "统计"}'
        config = {
            'id': uuid.uuid4().hex,
            'title': title,
            'kind': kind,
            'table_id': table_id,
            'aggregation': aggregation,
            'value_field': value_field,
            'value_fields': value_fields,
            'group_field': group_field if kind != 'metric' else None,
            'date_field': date_field,
            'date_bucket': bucket,
            'sort': raw.get('sort') if raw.get('sort') in {'value_desc', 'label_asc'} else ('label_asc' if kind == 'line' and group_field in dates else 'value_desc'),
            'limit': _int(raw.get('limit'), 24 if kind == 'line' else 10, 1, 30),
            'decimals': _int(raw.get('decimals'), 0 if aggregation == 'count' else 2, 0, 6),
            'unit': _text(raw.get('unit'), 12),
            'wide': bool(raw.get('wide')),
            'progress': None,
        }
        widgets.append({'config': config, 'reason': _text(raw.get('reason'), 200)})
    return widgets, warnings


def _field_name(fields, key):
    field = fields.get(key) if key else None
    return field['name'] if field else ''


def suggest(key, prompt, tables, default_table_id=None):
    started = time.monotonic()
    schema = []
    for table_id, table in tables.items():
        fields = []
        for field in table['fields'].values():
            item = {'key': field['key'], 'name': field['name'], 'type': field['type']}
            if field['type'] in {'select', 'multiselect'}:
                item['options'] = [option.get('name') for option in (field.get('options') or [])][:20]
            fields.append(item)
        schema.append({'table_id': table_id, 'name': table['name'], 'fields': fields})

    system = (
        '你是数据看板配置助手。根据用户想看的内容和表格字段，生成 1-4 个图表配置。'
        '只输出 JSON：{"widgets":[{"table_id":14,"title":"本月新增趋势","kind":"line","aggregation":"count",'
        '"value_field":null,"value_fields":[],"group_field":"字段key","date_field":"字段key","date_bucket":"month",'
        '"sort":"label_asc","limit":12,"decimals":0,"unit":"","reason":"一句话说明"}]}。\n'
        '规则：\n'
        '- 只能使用 schema 中存在的 table_id 和字段 key，不能编造字段。\n'
        '- group_field、value_field、value_fields、date_field 必须填写字段的 key（那串数字字母），不要填写字段名称。\n'
        '- metric 是单个数字卡片；bar 需要分组字段；pie 需要分组字段且只能 count 或 sum；line 需要分组字段，日期趋势时 group_field 用日期字段。\n'
        '- count 不需要 value_field；sum/avg/min/max 必须是数字、公式或汇总列。\n'
        '- bar/line 可用 value_fields 同时对比最多 3 个数字列。\n'
        '- 用户描述“每天/每周/每月/趋势”时用 line + 日期分组；描述“占比/构成”时用 pie；描述“对比/排名”时用 bar；只问总数时用 metric。\n'
        '- 用户没有明确说明的显示细节使用合理默认值；不确定时选最能回答问题的图表。\n'
        '- 标题使用简短中文，不超过 20 个字。\n'
    )
    if default_table_id:
        system += f'- 优先使用表格 {default_table_id}。\n'
    system += '\n表格 schema：' + json.dumps(schema, ensure_ascii=False)
    body = {
        'model': MODEL,
        'temperature': 0,
        'max_tokens': 2200,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': prompt.strip()},
        ],
    }
    try:
        response = httpx.post(
            'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            headers={'Authorization': 'Bearer ' + key},
            json=body,
            timeout=httpx.Timeout(60, connect=10),
        )
    except httpx.TimeoutException:
        raise ApiError('AI_TIMEOUT', 'AI 生成配置超时，请稍后重试', 504)
    except httpx.HTTPError:
        raise ApiError('AI_UNAVAILABLE', '无法连接智谱服务，请稍后重试', 502)
    if response.status_code != 200:
        message = {
            401: 'API Key 无效，请在设置 → AI 填表中更新',
            429: '模型请求频繁或额度不足，请稍后重试',
            403: '当前 Key 没有此模型的权限',
        }.get(response.status_code, '模型调用失败，请检查额度、权限或稍后重试')
        raise ApiError('AI_UPSTREAM', message, 502)
    try:
        result = response.json()
        content = result['choices'][0]['message']['content']
        if result['choices'][0].get('finish_reason') == 'length':
            raise ApiError('AI_TRUNCATED', '描述太复杂，模型输出被截断，请拆成几个问题', 422)
        raw_items = _json(content)
    except (KeyError, IndexError, TypeError):
        raise ApiError('AI_OUTPUT_INVALID', '模型没有返回可用的配置，请重试', 502)

    widgets, warnings = normalize(raw_items, tables, prompt)
    if not widgets:
        warnings.append('没有生成可用配置，请补充表格名称、指标或分组方式后再试')
    return {
        'model': MODEL,
        'widgets': widgets,
        'warnings': warnings,
        'raw_text': content[:8000] if isinstance(content, str) else '',
        'duration_ms': round((time.monotonic() - started) * 1000),
    }
