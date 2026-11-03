"""Generate an additive, labelled local demo dataset. Never calls external APIs.

Run with server/.venv/bin/python scripts/seed_mock_data.py seed.
Use --preview for a separate SQLite database; repeat runs of a batch are idempotent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import sqlite3
import subprocess
import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TZ = ZoneInfo('Asia/Shanghai')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['seed', 'status'], nargs='?', default='seed')
parser.add_argument('--rows-per-table', type=int, default=10_000)
parser.add_argument('--as-of', type=date.fromisoformat, default=datetime.now(TZ).date())
parser.add_argument('--batch', default=None)
parser.add_argument('--preview', action='store_true')
args = parser.parse_args()
if not 1 <= args.rows_per_table <= 100_000:
    parser.error('--rows-per-table must be between 1 and 100000')
batch = args.batch or args.as_of.strftime('%Y%m%d')
import re
if not re.fullmatch(r'[A-Za-z0-9_-]{1,24}', batch):
    parser.error('--batch accepts 1–24 letters, numbers, underscores or hyphens')
MARKER = 'MOCK-LARGE-' + batch
PREFIX = f'【模拟{batch}】'
RUN = ROOT / '.run' / ('mock-preview' if args.preview else 'mock-data') / batch
RUN.mkdir(parents=True, exist_ok=True, mode=0o700)
if args.preview:
    os.environ.update(WB_ENV='test', WB_DATABASE_URL='sqlite:///' + str(RUN / 'preview.sqlite3'),
                      WB_STORAGE_DIR=str(RUN / 'storage'), WB_ADMIN_USERNAME='mock-preview',
                      WB_ADMIN_PASSWORD='mock-preview-only')
os.chdir(ROOT / 'server')
sys.path.insert(0, str(ROOT / 'server'))
from sqlalchemy import func, insert, select, text
from sqlalchemy.engine import make_url
from app.db import Base, SessionLocal, engine
from app.config import settings
from app.models import (ActivityInterval, Bookmark, BookmarkCategory, CheckinGroup, CheckinInstance,
                        CheckinRule, CheckinRuleVersion, Dashboard, DataField, DataRecord, DataTable,
                        Memo, MemoCategory, Note, NoteFolder, NoteRevision, NoteTag, NoteTagLink,
                        Todo, TodoList, User, WorkTarget, utcnow)
from app.services.dashboard import Widget, DateRange, aggregate, validate_source
from app.services.fields import validate_record
from app.services.periods import iter_periods

url = make_url(settings.database_url)
if not args.preview and not (url.host in {'127.0.0.1', 'localhost', '::1'}
                            and url.database == 'workbench_element_local'):
    raise SystemExit('Refusing to seed anything except the configured local workbench_element_local database; use --preview for SQLite.')
if args.preview:
    Base.metadata.create_all(engine)
    from app.main import bootstrap
    bootstrap()
NOW = utcnow()
RNG = random.Random(20261103)
START = args.as_of - timedelta(days=89)
COUNTS: dict[str, int] = {}
IDS: dict[str, list[int]] = {}
SOURCES: dict[str, tuple] = {}


def stamp(day: date, hour=12):
    return min(NOW, datetime.combine(day, time(hour), TZ).astimezone(timezone.utc).replace(tzinfo=None))


def money(value):
    return format(Decimal(str(value)).quantize(Decimal('.01')), 'f')


def add(db, obj):
    db.add(obj)
    db.flush()
    name = obj.__tablename__
    COUNTS[name] = COUNTS.get(name, 0) + 1
    IDS.setdefault(name, []).append(obj.id)
    return obj


def snapshot(db):
    tables = db.scalars(select(DataTable).where(DataTable.note.startswith(MARKER+'｜'))).all()
    return {'marker': MARKER, 'tables': [{'id': t.id, 'name': t.name,
            'rows': db.scalar(select(func.count()).select_from(DataRecord).where(DataRecord.table_id == t.id)),
            'columns': db.scalar(select(func.count()).select_from(DataField).where(DataField.table_id == t.id))} for t in tables]}


def backup():
    path = RUN / ('before-seed-' + NOW.strftime('%Y%m%dT%H%M%S') + '.dump')
    env = os.environ.copy()
    if url.password:
        env['PGPASSWORD'] = url.password
    subprocess.run(['pg_dump', '-h', url.host, '-p', str(url.port or 5432), '-U', url.username,
                    '-Fc', '-f', str(path), url.database], env=env, check=True, capture_output=True)
    path.chmod(0o600)
    return str(path)


def table(db, code, name, definitions):
    t = add(db, DataTable(name=PREFIX + name, note=f'{MARKER}｜纯模拟数据，不代表真实经营。', sort_order=900 + len(SOURCES)))
    fields = []
    for i, spec in enumerate(definitions):
        label, kind, *options = spec
        fields.append(add(db, DataField(table_id=t.id, name=label,
            key=hashlib.sha256(f'{MARKER}:{code}:{i}'.encode()).hexdigest()[:32], type=kind, sort_order=i,
            options=[{'id': value, 'name': value} for value in options[0]] if options else None)))
    keys = {f.name: f.key for f in fields}
    SOURCES[code] = (t, fields, keys)
    return t, fields, keys


def fill_table(db, code, definitions, generate):
    t, fields, keys = table(db, code, {'orders':'订单明细','daily':'经营日报','inventory':'商品库存','ads':'广告投放','wide':'200列压力测试'}[code], definitions)
    rows = []
    for i in range(args.rows_per_table):
        values = generate(i)
        data = {keys[name]: value for name, value in values.items()}
        if i < 5 or i == args.rows_per_table - 1:
            validate_record(db, fields, data, table_id=t.id)
        rows.append({'table_id': t.id, 'data': data, 'created_at': stamp(START + timedelta(days=i % 90)), 'updated_at': NOW})
        if len(rows) == 250:
            db.execute(insert(DataRecord), rows)
            rows.clear()
    if rows:
        db.execute(insert(DataRecord), rows)
    COUNTS['data_records'] = COUNTS.get('data_records', 0) + args.rows_per_table
    print(f'Generated {code}: {args.rows_per_table} rows / {len(fields)} columns', flush=True)


def seed_tables(db):
    stores = [f'店铺{i+1:02}' for i in range(12)]
    categories = ['家居清洁', '厨房用品', '收纳整理', '生活配件']
    def common(i):
        return {'日期': (START + timedelta(days=i % 90)).isoformat(), '店铺': stores[(i // 90) % 12]}
    fill_table(db, 'orders', [('订单编号','short_text'),('日期','date'),('店铺','short_text'),('商品','short_text'),('品类','select',categories),('数量','number'),('销售额','number'),('成本','number'),('利润','number'),('状态','select',['待付款','待发货','已发货','已完成','已退款']),('已核对','checkbox'),('备注','long_text')],
        lambda i: {**common(i), '订单编号':f'MOCK-{batch}-{i+1:06}', '商品':f'模拟商品{i%300+1:03}', '品类':categories[i%4], '数量':str(i%8+1), '销售额':money((i%8+1)*(29.9+i%100)), '成本':money((i%8+1)*(15.5+i%50)), '利润':money((i%8+1)*(Decimal('14.4')+i%100-i%50)), '状态':['待付款','待发货','已发货','已完成','已退款'][i%5], '已核对':i%3!=0, '备注':'脚本生成的模拟订单，用于筛选、排序和导出验证。'})
    def daily(i):
        sales = Decimal(600 + i%1000)*Decimal('1.25')
        cost = (sales*Decimal('.58')).quantize(Decimal('.01'))
        return {**common(i), '渠道':['自然流量','付费推广','社媒引流'][i%3], '销售额':money(sales), '成本':money(cost), '利润':money(sales-cost), '订单数':str(10+i%40), '访客数':str(100+i%900), '退款金额':money(i%30), '已核对':i%4!=0}
    fill_table(db, 'daily', [('日期','date'),('店铺','short_text'),('渠道','select',['自然流量','付费推广','社媒引流']),('销售额','number'),('成本','number'),('利润','number'),('订单数','number'),('访客数','number'),('退款金额','number'),('已核对','checkbox')], daily)
    fill_table(db, 'inventory', [('SKU','short_text'),('日期','date'),('店铺','short_text'),('商品','short_text'),('品类','select',categories),('仓库','short_text'),('库存数量','number'),('安全库存','number'),('库存金额','number'),('采购单价','number'),('需要补货','checkbox')],
        lambda i: {**common(i),'SKU':f'MOCK-SKU-{i+1:06}','商品':f'模拟库存商品{i+1:05}','品类':categories[i%4],'仓库':['华东仓','华南仓','华北仓'][i%3],'库存数量':str(i%150),'安全库存':'30','库存金额':money((i%150)*(10+i%80)),'采购单价':money(10+i%80),'需要补货':i%150<30})
    fill_table(db, 'ads', [('日期','date'),('店铺','short_text'),('平台','select',['巨量千川','直通车','万相台','小红书']),('计划名称','short_text'),('广告花费','number'),('归因收入','number'),('收益','number'),('曝光量','number'),('点击量','number'),('转化单数','number'),('是否启用','checkbox')],
        lambda i: {**common(i),'平台':['巨量千川','直通车','万相台','小红书'][i%4],'计划名称':f'模拟推广计划{i%80+1:02}','广告花费':money(50+i%300),'归因收入':money(100+i%900),'收益':money(50+i%900-i%300),'曝光量':str(1000+i%30000),'点击量':str(30+i%800),'转化单数':str(i%30),'是否启用':i%7!=0})
    wide = [('序号','number'),('日期','date'),('店铺','short_text')] + [(f'指标{i:03}','number') for i in range(1,198)]
    fill_table(db, 'wide', wide, lambda i: {**common(i),'序号':str(i+1),**{f'指标{j:03}':money(((i+1)*j)%100000/100) for j in range(1,198)}})


def seed_checkins(db):
    groups = [add(db, CheckinGroup(name=PREFIX + name, sort_order=900+i)) for i, name in enumerate(['合规巡检','订单履约','客服跟进','库存盘点','数据复盘','投放检查','内容发布','周月总结'])]
    for i in range(20):
        kind = 'shop' if i < 12 else 'social'
        target = add(db, WorkTarget(kind=kind, name=PREFIX + (f'店铺{i+1:02}' if kind=='shop' else f'社媒账号{i-11:02}'),
            platform=(['天猫','京东','抖音','拼多多'] if kind=='shop' else ['小红书','抖音','视频号','B站'])[i%4], note=MARKER, sort_order=900+i, created_at=stamp(START)))
        add(db, ActivityInterval(target_id=target.id, start_at=stamp(START), reason=MARKER))
        for j in range(8):
            period = ['daily']*4 + ['weekly']*2 + ['monthly']*2
            rule = add(db, CheckinRule(target_id=target.id, group_id=groups[j].id,
                title=['检查违规与通知','核对订单及履约','回复留言与咨询','检查库存并补货','复盘经营数据','调整投放计划','整理并发布内容','完成月度经营总结'][j],
                description='模拟任务：核对数据，记录异常，并在完成后打卡。', period=period[j], sort_order=j, created_at=stamp(START)))
            add(db, CheckinRuleVersion(rule_id=rule.id, title=rule.title, description=rule.description,
                group_id=rule.group_id, group_name=groups[j].name, period=rule.period, change_summary=MARKER, effective_from=stamp(START)))
            instances = []
            for start, end in iter_periods(rule.period, START, args.as_of):
                historical = end <= args.as_of
                completed = RNG.random() < (.88 if historical else .35)
                instances.append({'rule_id':rule.id,'target_id':target.id,'target_name':target.name,'group_id':groups[j].id,
                    'group_name':groups[j].name,'period_type':rule.period,'period_start':start,'period_end':end,
                    'title':rule.title,'description':rule.description,'completed_at':stamp(min(args.as_of,end-timedelta(days=1)),15) if completed else None,
                    'note':'模拟：已核对，无异常。' if completed else None,'locked':historical,'lock_reason':'周期已结束' if historical else None,'sort_index':j,
                    'created_at':stamp(max(START,start)),'updated_at':NOW})
            db.execute(insert(CheckinInstance), instances)
            COUNTS['checkin_instances'] = COUNTS.get('checkin_instances',0) + len(instances)


def seed_content(db):
    labels = ['运营执行','商品上新','投放优化','客服跟进','库存采购','内容排期','数据复盘','技术维护','本周计划','下月筹备']
    for n, label in enumerate(labels):
        lst = add(db, TodoList(name=PREFIX+label, sort_order=900+n))
        for i in range(120):
            done = i%4 == 0
            parent = add(db, Todo(list_id=lst.id, title=f'{label}：模拟事项 {i+1:03}', note=MARKER+'｜检查资料、执行并记录结果。',
                due_date=args.as_of+timedelta(days=(i%43)-14), completed_at=stamp(args.as_of-timedelta(days=i%10)) if done else None, sort_index=i))
            if i%6 == 0:
                for j in range(3):
                    add(db, Todo(list_id=lst.id, parent_id=parent.id, title=['收集资料','完成执行','复核结果'][j], note=MARKER,
                        completed_at=parent.completed_at if done else None, sort_index=j))
    tags = [add(db, NoteTag(name=PREFIX+name)) for name in ['运营','复盘','模板','重要','待完善']]
    for n, label in enumerate(['经营复盘','操作流程','选品资料','投放记录','客服话术','内容素材','技术笔记','会议纪要']):
        folder = add(db, NoteFolder(name=PREFIX+label, sort_order=900+n))
        for i in range(15):
            content = f'# {label} · 示例 {i+1}\n\n> {MARKER}：以下均为虚构示例。\n\n## 目标\n提高执行效率并检查数据一致性。\n\n## 检查清单\n- [ ] 收集资料\n- [x] 核对数据\n- [ ] 记录结果\n\n| 项目 | 说明 |\n| --- | --- |\n| 数据 | 全部为模拟值 |\n| 用途 | 界面、搜索与保存验证 |\n\n```text\nmock_batch = '+MARKER+'\n```\n\n'
            content += ('这是一段用于测试编辑、预览和自动保存的模拟内容。\n\n' * (3+i*2))
            note = add(db, Note(folder_id=folder.id, title=f'{label}｜模拟记录{i+1:02}', content=content, created_at=stamp(args.as_of-timedelta(days=i))))
            add(db, NoteRevision(note_id=note.id, title=note.title, content=content, reason='manual'))
            for tag in [tags[n%5], tags[(n+1)%5]]:
                add(db, NoteTagLink(note_id=note.id, tag_id=tag.id))
    categories = [PREFIX+name for name in ['工作灵感','供应商信息','临时记录','运营提示','产品想法','会议要点','开发备忘','个人事项']]
    for name in categories:
        add(db, MemoCategory(name=name))
    for i in range(120):
        lines = [1,3,8,20,45][i%5]
        content = '\n'.join(f'模拟内容 {i+1}-{j+1}：核对事项并记录结果。' for j in range(lines))
        add(db, Memo(title=f'模拟便利贴 {i+1:03}' if i%4 else '', content=content,
            category=None if i%10==0 else categories[i%8], color=['default','yellow','green','blue','pink','purple'][i%6]))
    for n, label in enumerate(['运营资料','设计参考','开发文档','常用工具']):
        name = PREFIX+label
        add(db, BookmarkCategory(name=name))
        for i in range(6):
            add(db, Bookmark(title=f'模拟{label}{i+1:02}', url=f'https://example.com/?mock={MARKER}&item={n*6+i+1}', category=name, description='模拟占位链接，未访问外部服务。'))


def seed_boards(db, user):
    def widget(code, title, kind='metric', value='销售额', group=None, unit='元', values=None, aggregation='sum'):
        t, _, keys = SOURCES[code]
        data = {'id':hashlib.sha256((MARKER+title).encode()).hexdigest()[:24], 'title':title,'kind':kind,
            'table_id':t.id,'aggregation':aggregation,'value_field':keys.get(value),'value_fields':[keys[name] for name in (values or [])],
            'group_field':keys.get(group),'date_field':keys.get('日期'),'date_bucket':'day','limit':14,
            'sort':'label_asc' if group=='日期' else 'value_desc','decimals':2 if unit=='元' else 0,'unit':unit,
            'wide':kind=='line'}
        model = Widget.model_validate(data)
        validate_source(db, model)
        return model.model_dump(mode='json')
    plans = [
        ('经营总览', [widget('daily',v,value=v) for v in ['销售额','成本','利润']] +
         [widget('daily','销售、成本与利润趋势','line',group='日期',values=['销售额','成本','利润']),
          widget('daily','各店铺经营对比','bar',group='店铺',values=['销售额','成本','利润']),
          widget('orders','订单状态占比','pie',group='状态',aggregation='count',unit='单'),
          widget('daily','每日订单数','line',value='订单数',group='日期',unit='单')]),
        ('库存看板',[widget('inventory','库存总量',value='库存数量',unit='件'),widget('inventory','库存总金额',value='库存金额'),
                    widget('inventory','各仓库存量','bar',value='库存数量',group='仓库',unit='件'),widget('inventory','品类库存占比','pie',value='库存数量',group='品类',unit='件')]),
        ('广告投放',[widget('ads','广告花费',value='广告花费'),widget('ads','归因收入',value='归因收入'),
                   widget('ads','广告花费与收入趋势','line',group='日期',values=['广告花费','归因收入']),
                   widget('ads','各平台花费对比','bar',value='广告花费',group='平台')]),
    ]
    available = max(0, 30-(db.scalar(select(func.count()).select_from(Dashboard).where(Dashboard.user_id==user.id)) or 0))
    for name, widgets in plans[:available]:
        add(db, Dashboard(user_id=user.id, name=PREFIX+name, widgets=widgets))
    return [Widget.model_validate(w) for _, widgets in plans[:available] for w in widgets]


def main():
    with SessionLocal() as db:
        existing = snapshot(db)
    if args.action=='status' or existing['tables']:
        if existing['tables']:
            existing['message']='This batch already exists; no duplicate data was added.'
        print(json.dumps(existing,ensure_ascii=False,indent=2))
        return
    before_backup = None if args.preview else backup()
    print('Backup ready; generating additive mock data.', flush=True)
    with SessionLocal.begin() as db:
        if engine.dialect.name=='postgresql':
            lock_key = int(hashlib.sha256(MARKER.encode()).hexdigest()[:15],16)
            db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key':lock_key})
        if snapshot(db)['tables']:
            raise SystemExit('Another run already created this batch; nothing added.')
        user = db.scalar(select(User).order_by(User.id))
        if user is None:
            raise SystemExit('Start the application once before adding mock data.')
        seed_tables(db)
        seed_checkins(db)
        seed_content(db)
        widgets = seed_boards(db, user)
        results = aggregate(db, widgets, DateRange())
        failures = [r for r in results if r['status']!='ok']
        if failures:
            raise RuntimeError('Generated dashboard validation failed: '+json.dumps(failures,ensure_ascii=False))
        verified = snapshot(db)
        if len(verified['tables'])!=5 or any(t['rows']!=args.rows_per_table for t in verified['tables']):
            raise RuntimeError('Generated row counts do not match the requested dataset.')
    report = {'marker':MARKER,'prefix':PREFIX,'as_of':args.as_of.isoformat(),'preview':args.preview,
              'backup':before_backup,'counts':COUNTS,'entity_ids':IDS,'tables':verified['tables'],
              'dashboard_widgets':len(widgets),'verification':'Row counts, representative field values and every generated dashboard passed.'}
    temp = RUN/'manifest.tmp'
    temp.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    temp.replace(RUN/'manifest.json')
    print(json.dumps({k:v for k,v in report.items() if k!='entity_ids'},ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()