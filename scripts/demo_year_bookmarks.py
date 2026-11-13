"""Attach a year of labelled demo bookmarks to the demo-year dataset.

One-off companion for scripts/demo_year.py when the dataset was seeded before
bookmarks were included. Idempotent and recorded in the same manifest so the
main `remove` action can clean it up.
"""
from __future__ import annotations

import json
import random
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Bookmark, BookmarkCategory  # noqa: E402

PREFIX = '【模拟】'
MANIFEST = ROOT / '.run' / 'demo-year' / 'manifest.json'
if not MANIFEST.exists():
    raise SystemExit('No demo-year manifest found; seed scripts/demo_year.py first')
manifest = json.loads(MANIFEST.read_text())
if manifest.get('state') != 'seeded':
    raise SystemExit(f"Dataset state is {manifest.get('state')!r}; nothing to extend")
MARK = manifest['marker']
START = date.fromisoformat(manifest['from'])
END = date.fromisoformat(manifest['to'])
RNG = random.Random(20261031)

SPECS = [
    ('运营后台', '天猫商家中心', 'https://myseller.taobao.com/', '查看店铺经营、订单与活动报名'),
    ('运营后台', '抖音电商罗盘', 'https://compass.jinritemai.com/', '直播与短视频成交、流量和人群分析'),
    ('运营后台', '京东商家后台', 'https://shop.jd.com/', '商品、订单、库存与售后处理'),
    ('运营后台', '拼多多商家后台', 'https://mms.pinduoduo.com/', '活动报名、推广与发货管理'),
    ('数据工具', '生意参谋', 'https://sycm.taobao.com/', '店铺流量、转化与竞争分析'),
    ('数据工具', '巨量算数', 'https://trendinsight.oceanengine.com/', '行业趋势、关键词与内容热点'),
    ('内容平台', '小红书创作中心', 'https://creator.xiaohongshu.com/', '笔记发布、数据与选题灵感'),
    ('内容平台', '视频号助手', 'https://channels.weixin.qq.com/', '视频号内容发布与直播管理'),
    ('学习资料', '阿里妈妈营销学院', 'https://www.alimama.com/', '投放方法与活动策略学习'),
    ('学习资料', '淘宝大学', 'https://daxue.taobao.com/', '电商运营课程与案例'),
    ('协作工具', '飞书', 'https://www.feishu.cn/', '团队文档、表格与周会协作'),
    ('协作工具', 'Notion', 'https://www.notion.so/', '复盘模板与知识库整理'),
    ('协作工具', '稿定设计', 'https://www.gaoding.com/', '活动主图、详情页与内容素材'),
    ('数据工具', '快递100', 'https://www.kuaidi100.com/', '物流时效查询与异常件跟进'),
    ('运营后台', '微信公众平台', 'https://mp.weixin.qq.com/', '公众号内容与用户消息管理'),
]


def stamp(day: date, hour: int = 10, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute))


with SessionLocal.begin() as db:
    if db.scalar(select(Bookmark.id).where(Bookmark.title.startswith(PREFIX)).limit(1)):
        print('Demo bookmarks already present; nothing to add')
        raise SystemExit(0)

    categories = {}
    for name in ['运营后台', '数据工具', '内容平台', '学习资料', '协作工具']:
        full = PREFIX + name
        row = db.scalar(select(BookmarkCategory).where(BookmarkCategory.name == full))
        if row is None:
            row = BookmarkCategory(name=full)
            db.add(row)
            db.flush()
        categories[name] = row

    bookmarks = []
    for index, (category, title, url, description) in enumerate(SPECS):
        day = START + timedelta(days=18 + index * 23)
        row = Bookmark(
            title=PREFIX + title, url=url, category=categories[category].name, icon_url='', description=description,
            created_at=stamp(day), updated_at=stamp(min(day + timedelta(days=RNG.randint(0, 30)), END), 15),
        )
        db.add(row)
        bookmarks.append(row)
    db.flush()

    entities = manifest.setdefault('entities', {})
    entities.setdefault('bookmarks', []).extend(row.id for row in bookmarks)
    entities.setdefault('bookmark_categories', []).extend(row.id for row in categories.values())
    counts = manifest.setdefault('counts', {})
    counts['bookmarks'] = len(entities['bookmarks'])
    counts['bookmark_categories'] = len(entities['bookmark_categories'])
    manifest['marker_note'] = f'{MARK} 书签补齐：{len(bookmarks)} 条'
    temp = MANIFEST.with_suffix('.tmp')
    temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    temp.replace(MANIFEST)

print(f'Added {len(bookmarks)} demo bookmarks across {len(categories)} categories')
