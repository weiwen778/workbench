"""Add a removable year of synthetic e-commerce activity.

Run locally from the project's server directory. Never calls external APIs.
Pass --unlabeled for realistic data without visible mock prefixes or marker columns.
"""
from __future__ import annotations
import argparse, calendar, hashlib, json, math, os, random, secrets, sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
if not (ROOT/'server/app').exists():
    ROOT=Path('/home/weiwen/workbench')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('action',choices=['seed','status','remove'],nargs='?',default='seed')
parser.add_argument('--as-of',type=date.fromisoformat,default=date(2026,10,31))
parser.add_argument('--preview',action='store_true',help='Use a separate disposable SQLite database')
parser.add_argument('--unlabeled',action='store_true',help='Generate realistic data without visible mock prefixes or marker columns')
parser.add_argument('--confirm',default='')
args=parser.parse_args()
HOME=ROOT/'.run'/('demo-year-preview' if args.preview else 'demo-year')
HOME.mkdir(parents=True,exist_ok=True,mode=0o700)
if args.preview:
    os.environ['WB_ENV']='test'
    os.environ['WB_DATABASE_URL']='sqlite:///'+str(HOME/'preview.sqlite3')
    os.environ['WB_STORAGE_DIR']=str(HOME/'storage')
sys.path.insert(0,str(ROOT/'server'))
from sqlalchemy import delete, func, inspect, select, text
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.main import bootstrap
from app.models import *
from app.services.dashboard import Widget, DateRange, aggregate, validate_source
from app.services.fields import validate_record
from app.services.periods import iter_periods

LOCAL_DB = settings.is_sqlite or '127.0.0.1' in settings.database_url or 'localhost' in settings.database_url
assert LOCAL_DB, 'This utility is only for the local workspace database'
if settings.env == 'production':
    print('WARNING: local workspace is marked production; seeding removable demo data.')
ASOF=args.as_of
END=ASOF-timedelta(days=1)
START=END-timedelta(days=364)
MARK=f'DEMO-YEAR-{ASOF:%Y%m%d}'
LABELED=not args.unlabeled
PREFIX='【模拟】' if LABELED else ''
MANIFEST=HOME/'manifest.json'
TZ=ZoneInfo('Asia/Shanghai')
NOW=datetime.now(timezone.utc).replace(tzinfo=None)
RNG=random.Random(20261031)
def stamp(day,hour=10,minute=0):
    return min(datetime.combine(day,time(hour,minute),TZ).astimezone(timezone.utc).replace(tzinfo=None),NOW)
def money(value): return f'{Decimal(str(value)).quantize(Decimal("0.01")):.2f}'
def tag(text): return f'{MARK}｜{text}' if LABELED else text
def save_manifest(data):
    temp=MANIFEST.with_suffix('.tmp'); temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)); temp.replace(MANIFEST)
def field_key(code,name): return hashlib.md5((MARK+code+name).encode()).hexdigest()

PROFILES=[
    ('tmall','天猫旗舰店','天猫',72,129.5,.35,.06,.45,.17,.055,6.2,.04),
    ('douyin','抖音自营店','抖音',115,89,.65,.12,.39,.25,.05,6.2,.045),
    ('jd','京东专营店','京东',50,169,.25,.04,.48,.13,.06,7.5,.04),
    ('pdd','拼多多品牌店','拼多多',170,49,.30,.08,.50,.22,.012,5.2,.035),
    ('taobao','淘宝精选店','淘宝',38,119,.18,.065,.46,.15,.025,6,.055),
    ('weixin','视频号小店','视频号',25,99,.95,.085,.44,.19,.03,6.8,.06),
]
OWNERS=[name+('（模拟）' if LABELED else '') for name in ['小林','小周','小何','小陈']]
CATEGORIES=['收纳整理','厨房用品','家居清洁','生活配件']

class Seeder:
    def __init__(self,db):
        self.db=db; self.entities=defaultdict(list); self.tables={}; self.totals={}; self.daily={}; self.boards={}
    def add(self,obj):
        self.db.add(obj); self.entities[obj.__tablename__].append(obj); return obj
    def table(self,code,name,definitions):
        note=tag(f'纯模拟数据，非实际经营结果。统计范围：{START} 至 {END}。') if LABELED else f'统计范围：{START} 至 {END}。'
        table=self.add(DataTable(name=PREFIX+name,note=note,sort_order=100+len(self.tables),created_at=stamp(START),updated_at=stamp(END,23)))
        self.db.flush()
        fields=[]; keys={}
        specs=[*definitions,('数据标识','short_text')] if LABELED else list(definitions)
        for i,definition in enumerate(specs):
            name,kind,*options=definition
            field=self.add(DataField(table_id=table.id,key=field_key(code,name),name=name,type=kind,sort_order=i,required=LABELED and name=='数据标识',options=[{'id':str(v),'name':str(v)} for v in options[0]] if options else None,created_at=stamp(START)))
            fields.append(field); keys[name]=field.key
        self.db.flush(); self.tables[code]=(table,fields,keys)
        return code
    def record(self,code,values,day):
        table,fields,keys=self.tables[code]
        payload={**values,**({'数据标识':MARK} if LABELED else {})}
        data={keys[k]:v for k,v in payload.items()}
        data=validate_record(self.db,fields,data,table_id=table.id)
        return self.add(DataRecord(table_id=table.id,data=data,created_at=stamp(day,18),updated_at=stamp(day,19),version=RNG.choice([1,1,1,2,3])))
    def widget(self,code,title,kind='metric',aggregation='sum',value='净销售额',group=None,**extra):
        table,fields,keys=self.tables[code]
        config={'id':field_key(code,title),'title':title,'kind':kind,'table_id':table.id,'aggregation':aggregation,'value_field':keys.get(value),'group_field':keys.get(group),'date_field':keys.get('日期'),'date_bucket':'month' if group=='日期' else 'day','sort':'label_asc' if group=='日期' else 'value_desc','limit':13 if group=='日期' else 10,'decimals':0 if value in ['订单数','库存数量'] or aggregation=='count' else 2,'unit':'单' if value=='订单数' else '' if aggregation=='count' else '元'}
        config.update(extra)
        w=Widget.model_validate(config); validate_source(self.db,w); return w.model_dump(mode='json')
    def board(self,name,widgets):
        board=self.add(Dashboard(user_id=self.user.id,name=PREFIX+name,widgets=widgets,version=RNG.randint(3,12),created_at=stamp(START+timedelta(days=30)),updated_at=stamp(END,22)))
        self.db.flush(); self.boards[name]=board.id
    def business(self):
        definitions=[('日期','date'),('店铺','short_text'),('平台','select',[p[2] for p in PROFILES]),('支付销售额','number'),('退款金额','number'),('净销售额','number'),('订单数','number'),('访客数','number'),('转化率','number'),('推广费','number'),('商品成本','number'),('平台佣金','number'),('物流成本','number'),('运营分摊成本','number'),('经营利润','number'),('利润率','number'),('投产比','number'),('日报状态','select',['已核对','待核对','异常已复盘']),('经营备注','short_text')]
        self.table('all','全店经营日报',definitions)
        for p in PROFILES:
            code,name,platform,orders,aov,growth,refund,cogs,ads,fee,ship,op=p
            self.table(code,name+' · 经营日报',definitions)
            rows=[]
            for i in range(365):
                day=START+timedelta(days=i); maturity=i/364
                event=1.0
                if day.month==11 and 1<=day.day<=11: event=1.65+(2.2 if day.day==11 else 0)
                elif day.month==12 and 1<=day.day<=12: event=1.3+(1.1 if day.day==12 else 0)
                elif day.month==6 and day.day<=18: event=1.45+(1.5 if day.day==18 else 0)
                elif day.month==3 and day.day<=8: event=1.15+(0.65 if day.day==8 else 0)
                elif day.month==9 and day.day<=9: event=1.15+(0.7 if day.day==9 else 0)
                elif day.month==10 and day.day>=21: event=1.35
                if day.month==2 and day.day<20: event*=.72
                weekly=1.13 if day.weekday()>=5 else .96 if day.weekday()==0 else 1.0
                volume=max(3,round(orders*(1+growth*maturity)*event*weekly*max(.62,RNG.gauss(1,.13))))
                note='日常经营'
                if code=='tmall' and day.month==8 and 20<=day.day<=27: volume=round(volume*.72); note='主图测试转化下降，已回滚并复盘'
                if code=='pdd' and day.month==10 and 18<=day.day<=23: volume=round(volume*.65); note='主推款库存受限，已安排紧急补货'
                if event>1.3 and note=='日常经营': note='大促/预热期：放量同时控制利润'
                price=aov*(1+.055*maturity)*RNG.uniform(.94,1.06)*(0.93 if event>1.4 else 1)
                gross=round(volume*price,2)
                rate=max(.01,refund+RNG.uniform(-.018,.018)+(0.025 if event>1.5 else 0))
                if code=='douyin' and day.month==5 and 15<=day.day<=22: rate+=.07; note='素材承诺与商品体验不一致，退款率升高'
                returned=round(gross*rate,2); net=round(gross-returned,2)
                adratio=ads+RNG.uniform(-.025,.025)+(0.045 if event>1.4 else 0)-(.055*maturity if code=='pdd' else .018*maturity)
                spend=round(gross*max(.06,adratio),2)
                if code=='douyin' and day.month==5 and 15<=day.day<=22:
                    spend=round(spend+gross*.22,2)
                    note='投放扩量与退款叠加导致亏损，已停低效素材并复盘'
                cost=round(net*cogs*RNG.uniform(.97,1.03),2); commission=round(net*fee,2)
                logistics=round(volume*ship*RNG.uniform(.93,1.08),2); operations=round(net*op,2)
                profit=round(net-spend-cost-commission-logistics-operations,2)
                visitors=max(volume+1,round(volume/RNG.uniform(.021,.044)))
                row={'日期':day.isoformat(),'店铺':name,'平台':platform,'支付销售额':money(gross),'退款金额':money(returned),'净销售额':money(net),'订单数':str(volume),'访客数':str(visitors),'转化率':money(volume/visitors*100),'推广费':money(spend),'商品成本':money(cost),'平台佣金':money(commission),'物流成本':money(logistics),'运营分摊成本':money(operations),'经营利润':money(profit),'利润率':money(profit/net*100),'投产比':money(gross/spend),'日报状态':'异常已复盘' if note not in ['日常经营','大促/预热期：放量同时控制利润'] else '待核对' if day==END and code in ['douyin','pdd'] else '已核对','经营备注':note}
                self.record(code,row,day); self.record('all',row,day); rows.append(row)
            self.daily[code]=rows
            self.totals[code]={key:money(sum(Decimal(r[key]) for r in rows)) for key in ['支付销售额','净销售额','推广费','经营利润','订单数']}
            self.db.flush()
        self.board('全店经营总览',[
            self.widget('all','净销售额'),self.widget('all','经营利润',value='经营利润'),self.widget('all','订单量',value='订单数'),self.widget('all','推广投入',value='推广费'),
            self.widget('all','近一年净销售额趋势','line',group='日期',wide=True),self.widget('all','各店铺净销售额','bar',group='店铺'),self.widget('all','各店铺经营利润','bar',value='经营利润',group='店铺'),self.widget('all','销售额店铺占比','pie',group='店铺'),
        ])
        for p in PROFILES:
            code,name=p[:2]
            self.board(name,[self.widget(code,'净销售额'),self.widget(code,'经营利润',value='经营利润'),self.widget(code,'订单量',value='订单数'),self.widget(code,'推广投入',value='推广费'),self.widget(code,'月度净销售额趋势','line',group='日期'),self.widget(code,'月度经营利润','bar',value='经营利润',group='日期'),self.widget(code,'最近30天订单走势','line',value='订单数',group='日期',date_bucket='day',limit=30),self.widget(code,'日报核对情况','pie',aggregation='count',group='日报状态',value=None,decimals=0)])
    def products(self):
        self.table('products','商品与库存台账',[('店铺','short_text'),('SKU','short_text'),('商品名称','short_text'),('品类','select',CATEGORIES),('售价','number'),('采购成本','number'),('近30天销量','number'),('库存数量','number'),('在途库存','number'),('库存可售天数','number'),('年度成交额','number'),('退款率','number'),('商品状态','select',['主推','正常销售','待补货','清仓']),('负责人','short_text'),('最近上新日期','date')])
        names=['折叠收纳箱','分隔整理盒','旅行收纳袋','厨房沥水架','密封保鲜盒','硅胶隔热垫','可替换清洁刷','超细纤维抹布','多用途清洁海绵','便携洗漱包','桌面理线夹','防滑家居拖鞋']
        for p in PROFILES:
            code,name=p[:2]; weights=[RNG.uniform(.4,1.5) for _ in names]; total=sum(weights)
            annual=Decimal(self.totals[code]['支付销售额']); allocated=Decimal(0)
            last30=sum(int(r['订单数']) for r in self.daily[code][-30:])
            for i,product in enumerate(names):
                amount=(annual*Decimal(str(weights[i]/total))).quantize(Decimal('.01')) if i<11 else annual-allocated
                allocated+=amount
                sold=max(12,round(last30*1.2*weights[i]/total)); days=RNG.choice([3,5,9,15,22,31,45,68])
                stock=round(sold/30*days); status='待补货' if days<7 else '清仓' if days>60 else '主推' if i<3 else '正常销售'
                price=RNG.uniform(29,199); cost=price*RNG.uniform(.38,.60)
                self.record('products',{'店铺':name,'SKU':f'{code.upper()}-{i+1:03d}','商品名称':product+' · '+['标准款','升级款','组合装'][i%3],'品类':CATEGORIES[i//3],'售价':money(price),'采购成本':money(cost),'近30天销量':str(sold),'库存数量':str(stock),'在途库存':str(round(sold*.5) if days<15 else 0),'库存可售天数':str(days),'年度成交额':money(amount),'退款率':money(RNG.uniform(1.5,9.5)),'商品状态':status,'负责人':OWNERS[i%4],'最近上新日期':(START+timedelta(days=RNG.randrange(280))).isoformat()},END)
        self.board('商品与库存',[self.widget('products','在售SKU数',aggregation='count',value=None,decimals=0,unit='款'),self.widget('products','库存总件数',value='库存数量',decimals=0,unit='件'),self.widget('products','商品状态分布','pie',aggregation='count',group='商品状态',value=None,decimals=0),self.widget('products','各店库存件数','bar',value='库存数量',group='店铺',unit='件'),self.widget('products','品类成交额','bar',value='年度成交额',group='品类')])
    def campaigns(self):
        self.table('campaigns','推广活动复盘',[('日期','date'),('店铺','short_text'),('活动','short_text'),('计划结束日期','date'),('实际成交额','number'),('推广费','number'),('经营利润','number'),('投产比','number'),('目标成交额','number'),('达成率','number'),('状态','select',['已复盘','进行中']),('复盘结论','long_text')])
        events=[('双11大促',date(2025,11,1),date(2025,11,11)),('双12大促',date(2025,12,1),date(2025,12,12)),('春季焕新',date(2026,3,1),date(2026,3,8)),('618年中大促',date(2026,6,1),date(2026,6,18)),('99品牌日',date(2026,9,1),date(2026,9,9)),('双11蓄水预热',date(2026,10,21),date(2026,11,11))]
        for code,name,*_ in PROFILES:
            for title,start,end in events:
                rows=[r for r in self.daily[code] if start.isoformat()<=r['日期']<=min(end,END).isoformat()]
                amount=sum(Decimal(r['支付销售额']) for r in rows); spend=sum(Decimal(r['推广费']) for r in rows); profit=sum(Decimal(r['经营利润']) for r in rows)
                target=(amount*Decimal(str(RNG.uniform(.88,1.22))) if end<=END else amount*Decimal('1.85')).quantize(Decimal('.01'))
                self.record('campaigns',{'日期':start.isoformat(),'店铺':name,'活动':title,'计划结束日期':end.isoformat(),'实际成交额':money(amount),'推广费':money(spend),'经营利润':money(profit),'投产比':money(amount/spend),'目标成交额':money(target),'达成率':money(amount/target*100),'状态':'已复盘' if end<=END else '进行中','复盘结论':'活动进行中，成交与费用仅统计至 '+END.isoformat() if end>END else '销售放量同时追踪利润；保留高转化素材，降低低效投放，提前准备主推款库存。'},min(end,END))
        self.board('推广活动复盘',[self.widget('campaigns','活动记录数',aggregation='count',value=None,unit='场',decimals=0),self.widget('campaigns','活动成交额',value='实际成交额'),self.widget('campaigns','各店活动成交额','bar',value='实际成交额',group='店铺'),self.widget('campaigns','各店推广投入','bar',value='推广费',group='店铺'),self.widget('campaigns','活动状态','pie',aggregation='count',value=None,group='状态',decimals=0)])
    def exceptions(self):
        self.table('issues','经营异常与改善跟进',[('日期','date'),('店铺','short_text'),('异常类别','select',['投放','转化','库存','售后','履约']),('问题','short_text'),('优先级','select',['高','中','低']),('负责人','short_text'),('状态','select',['已解决','处理中','待处理']),('改善措施','long_text'),('处理结果','long_text')])
        issues=[('投放','推广消耗增长但成交未同步增长','缩减低效计划，保留高转化人群和素材'),('转化','主推商品详情页转化率下降','检查价格与评价，回滚低效主图并复测'),('库存','主推SKU预计7天内缺货','调整补货优先级，控制消耗并跟踪到仓'),('售后','直播渠道退款率阶段性上升','核对素材承诺与商品实际体验，更新客服说明'),('履约','个别仓库发货时效波动','排查仓库排班与揽收节点，更新发货预期')]
        for i in range(48):
            category,title,measure=issues[i%5]; day=START+timedelta(days=i*7+10)
            if i>=36: day=END-timedelta(days=(47-i)*2)
            state='已解决' if i<36 else '处理中' if i<44 else '待处理'
            self.record('issues',{'日期':day.isoformat(),'店铺':PROFILES[i%6][1],'异常类别':category,'问题':title,'优先级':'高' if i%6==0 else '中' if i%3 else '低','负责人':OWNERS[i%4],'状态':state,'改善措施':measure,'处理结果':'已完成修正并连续观察7天，核心指标恢复到正常区间。' if state=='已解决' else '已指定负责人，等待执行或效果观察。'},day)
        self.board('经营异常跟进',[self.widget('issues','异常记录',aggregation='count',value=None,unit='条',decimals=0),self.widget('issues','处理状态分布','pie',aggregation='count',value=None,group='状态',decimals=0),self.widget('issues','异常类别分布','bar',aggregation='count',value=None,group='异常类别',decimals=0),self.widget('issues','各店异常数量','bar',aggregation='count',value=None,group='店铺',decimals=0)])
    def checkins(self):
        groups={name:self.add(CheckinGroup(name=PREFIX+name,sort_order=100+i,created_at=stamp(START),updated_at=stamp(END))) for i,name in enumerate(['经营数据','投放与商品','经营复盘','内容运营'])}
        self.db.flush()
        specs=[('shop',p[1],p[2]) for p in PROFILES]+[('social','小红书·生活研究所','小红书'),('social','抖音·收纳实验室','抖音'),('social','视频号·好物日记','视频号')]
        for index,(kind,name,platform) in enumerate(specs):
            target=self.add(WorkTarget(kind=kind,name=PREFIX+name,platform=platform,note=tag('模拟运营对象，不关联真实店铺账号。') if LABELED else '运营对象：用于聚合日、周、月例行检查。',sort_order=100+index,status='active',generate_from=START,created_at=stamp(START,8),updated_at=stamp(END)))
            self.db.flush(); self.add(ActivityInterval(target_id=target.id,start_at=stamp(START,8),reason=MARK if LABELED else '开始运营'))
            rules=[('昨日经营数据核对','daily','经营数据'),('推广消耗与预算检查','daily','投放与商品'),('库存及售后异常巡检','daily','投放与商品'),('周度经营复盘','weekly','经营复盘'),('下周活动与备货排期','weekly','经营复盘'),('月度利润与目标复盘','monthly','经营复盘')] if kind=='shop' else [('评论与私信巡检','daily','内容运营'),('当日内容排期确认','daily','内容运营'),('内容表现与选题复盘','weekly','内容运营'),('月度内容转化复盘','monthly','经营复盘')]
            for j,(title,period,groupname) in enumerate(rules):
                group=groups[groupname]; changed=j==1 and kind=='shop'; switch=START+timedelta(days=180)
                current_title=title+'（含素材复核）' if changed else title
                rule=self.add(CheckinRule(target_id=target.id,group_id=group.id,title=current_title,description=tag('检查指标、记录异常、明确负责人并跟进到结果。'),period=period,sort_order=j,version=2 if changed else 1,created_at=stamp(START,8),updated_at=stamp(switch if changed else START,9)))
                self.db.flush()
                self.add(CheckinRuleVersion(rule_id=rule.id,title=title,description=rule.description,group_id=group.id,group_name=group.name,period=period,change_summary='模拟：创建周期事项' if LABELED else '创建周期事项',effective_from=stamp(START,8),effective_to=stamp(switch,9) if changed else None))
                if changed:self.add(CheckinRuleVersion(rule_id=rule.id,title=current_title,description=rule.description,group_id=group.id,group_name=group.name,period=period,change_summary='模拟：半年复盘后增加素材复核' if LABELED else '半年复盘后增加素材复核',effective_from=stamp(switch,9)))
                for first,last in iter_periods(period,START,ASOF):
                    if first<START: continue
                    historical=last<=ASOF
                    chance=.80+.14*min(1,(first-START).days/364)
                    done=RNG.random()<chance if historical else (j==0 and index%2==0)
                    completed=stamp(min(last-timedelta(days=1),END),17,RNG.randrange(60)) if historical and done else NOW-timedelta(minutes=2) if done else None
                    progress=('已完成核对；异常已转入跟进清单。' if done else (('历史漏打卡：用于模拟真实执行缺口。' if LABELED else '历史漏打卡。') if historical else '当前周期待执行。'))
                    self.add(CheckinInstance(rule_id=rule.id,target_id=target.id,target_name=target.name,group_id=group.id,group_name=group.name,period_type=period,period_start=first,period_end=last,title=title if changed and first<switch else current_title,description=rule.description,completed_at=completed,note=tag(progress),locked=historical,lock_reason='周期已结束' if historical else None,version=RNG.choice([1,2,3]),created_at=stamp(first,8),updated_at=completed or stamp(min(first,END),18)))
            self.db.flush()
    def todos(self):
        lists=[self.add(TodoList(name=PREFIX+name,sort_order=100+i,sort_mode='auto',created_at=stamp(START),updated_at=stamp(END))) for i,name in enumerate(['年度经营项目','活动与上新','异常跟进','本周行动'])]
        self.db.flush()
        actions=['核对店铺月度利润与费用','完成主推商品价格带分析','复盘低投产计划并调整预算','检查库存覆盖天数与到仓计划','整理客服高频问题并更新话术','验收活动主图与详情页','检查退款原因并跟进改善','输出竞品促销与上新观察']
        months=[(2025+(10+m)//12,(10+m)%12+1) for m in range(12)]
        for mi,(year,month) in enumerate(months):
            for j in range(14):
                day=date(year,month,min(27,2+j*2)); due=min(day+timedelta(days=2),END)
                self.add(Todo(list_id=lists[j%3].id,title=f'{PREFIX}{PROFILES[j%6][1]} · {actions[j%8]}',note=tag('执行结果：已形成结论、完成调整并同步到经营复盘。\n验收：观察7天，效果符合预期。'),due_date=due,completed_at=stamp(due,16),sort_index=mi*20+j,version=RNG.choice([2,3,4]),created_at=stamp(day-timedelta(days=1),10),updated_at=stamp(due,16)))
            current=mi==11; day=date(year,month,20)
            parent=self.add(Todo(list_id=lists[1].id,title=f'{PREFIX}{year}-{month:02d} 活动上线验收',note=tag('验收标准：页面、库存、预算与排期均完成核对。'),due_date=ASOF+timedelta(days=5) if current else day+timedelta(days=3),completed_at=None if current else stamp(day+timedelta(days=3),17),sort_index=mi*20+15,created_at=stamp(day),updated_at=stamp(min(day+timedelta(days=3),END))))
            self.db.flush()
            for k,title in enumerate(['确认活动规则与利益点','验收素材与落地页','核对库存和推广预算']):
                completed=not current or k==0
                self.add(Todo(list_id=parent.list_id,parent_id=parent.id,title=PREFIX+title,note=MARK if LABELED else None,sort_index=k,due_date=ASOF+timedelta(days=k+1) if current else day+timedelta(days=k+1),completed_at=stamp(END,15) if current and completed else stamp(day+timedelta(days=k+1),15) if completed else None,created_at=stamp(day),updated_at=stamp(END if current else day+timedelta(days=k+1))))
        for j in range(24):
            due=ASOF+timedelta(days=j//4-1)
            self.add(Todo(list_id=lists[3 if j<16 else 2].id,title=f'{PREFIX}{PROFILES[j%6][1]} · {actions[j%8]}',note=tag('当前进度：'+['待排期执行','已取得数据，等待复核','已委托Agent整理，待人工验收','处理中，需要协调补货或素材资源'][j%4]),due_date=due,due_time=time(17,30) if j%3==0 else None,sort_index=j,created_at=stamp(ASOF-timedelta(days=RNG.randint(1,7))),updated_at=stamp(END,18)))
    def notes_and_memos(self):
        folders={name:self.add(NoteFolder(name=PREFIX+name,created_at=stamp(START))) for name in ['经营复盘','流程与SOP','活动策略']}
        tags={name:self.add(NoteTag(name=PREFIX+name,created_at=stamp(START))) for name in ['复盘','经营管理','投放优化','库存与售后']}
        self.db.flush()
        def note(title,content,day,folder='经营复盘',tag='复盘',versions=2):
            if LABELED: content=f'{content}\n\n---\n> 模拟数据集：{MARK}；用于产品体验，非实际经营结论。'
            n=self.add(Note(title=PREFIX+title,content=content,folder_id=folders[folder].id,version=versions,created_at=stamp(day,9),updated_at=stamp(min(day+timedelta(days=max(0,versions-1)),END),18)))
            self.db.flush(); self.add(NoteTagLink(note_id=n.id,tag_id=tags[tag].id))
            for k in range(versions): self.add(NoteRevision(note_id=n.id,title=n.title,content=content if k==versions-1 else content.replace('下一步','待补充的下一步'),reason='manual',created_at=stamp(min(day+timedelta(days=k),END),12)))
            return n
        for m in range(12):
            year=2025+(10+m)//12; month=(10+m)%12+1
            day=min(date(year,month,calendar.monthrange(year,month)[1]),END)
            rows=[r for rows in self.daily.values() for r in rows if r['日期'].startswith(f'{year}-{month:02d}')]
            sales=sum(Decimal(r['净销售额']) for r in rows); profit=sum(Decimal(r['经营利润']) for r in rows)
            note(f'{year}年{month}月经营复盘',f'# 月度经营复盘\n\n## 核心结果\n- 净销售额：{sales:,.2f} 元\n- 经营贡献利润：{profit:,.2f} 元\n- 已统一核对六家店铺日报口径。\n\n## 发现的问题\n1. 大促拉动成交，但推广费用和退款同步上升。\n2. 部分SKU备货不足，影响活动承接。\n\n## 已执行的措施\n- 减少低效素材和计划，跟踪利润而非只看销售额。\n- 将库存覆盖天数纳入每周检查。\n\n## 下一步\n- 店铺负责人按异常清单跟进，周会复核结果。',day)
        for i in range(16):
            day=END-timedelta(days=(15-i)*7)
            note(f'{day:%m.%d} 周度运营例会',f'# 本周经营例会\n\n- 数据：检查访客、转化、推广费用和退款变化。\n- 进度：完成 {RNG.randint(8,14)} 项行动，{RNG.randint(1,4)} 项待跟进。\n- 决策：优先处理缺货和退款原因，保留高效计划。\n- 下一步：按店铺拆分负责人，给出截止时间与验收证据。',day)
        for title in ['店铺日报核对口径','推广预算调整流程','新品上线验收清单','库存告警与补货协同','退款原因排查流程','大促活动复盘模板','Agent回写结果验收','周会与月度复盘SOP']:
            note(title,f'# {title}\n\n## 适用范围\n适用于多店铺运营协作。\n\n## 执行步骤\n1. 先核对数据来源与时间范围。\n2. 找出异常并明确责任人。\n3. 将措施写入待办，补充截止日期与验收标准。\n4. 完成后回读数据，记录结果与经验。\n\n## 验收标准\n结论有数据支持，产物可查看，问题有后续跟进。',START+timedelta(days=RNG.randrange(300)),folder='流程与SOP',tag='经营管理',versions=3)
        for p in PROFILES:
            note(p[1]+' · 双11预热方案','# 双11预热方案\n\n## 目标\n提升高意向访客和主推款成交，同时控制推广消耗。\n\n## 排期\n- 预热阶段：测试素材，整理人群与商品承接。\n- 放量阶段：跟踪库存和利润，及时收缩低效计划。\n- 复盘阶段：沉淀有效素材与活动执行清单。',ASOF-timedelta(days=12),folder='活动策略',tag='投放优化')
        if LABELED:
            note('一年模拟数据使用说明',f'# 一年运营模拟数据\n\n覆盖 **{START} 至 {END}**，六家店铺。\n\n- 进入「数据可视化 → 【模拟】全店经营总览」查看全店表现。\n- 六家店铺各有独立日报表和独立看板。\n- 另有商品库存、推广复盘、经营异常和内容运营台账。\n- 待办包括已完成项目、当前行动及少量逾期事项。\n- 打卡包含日、周、月任务和一年的历史快照。\n\n## 统计说明\n经营利润 = 净销售额 − 商品成本 − 推广费 − 平台佣金 − 物流成本 − 运营分摊成本。\n投产比为支付销售额 / 推广费，不代表净利润率。\n年末是未完结的双11预热阶段，未来排期不是未来实际成交。\n\n## 数据标识\n所有新增对象带【模拟】或数据标识列；不覆盖原有记录。\nAgent、翻译记录均为合成示例，未触发外部API，没有生成可用的访问令牌。\n\n## 清理\n可以让助手“删除这一批一年模拟数据”。清理脚本按本次清单和标识处理，并保留非模拟内容。',END,folder='流程与SOP',tag='经营管理',versions=1)
        memos=[('日常巡检三件事','先看异常，再看负责人，最后核对行动结果。'),('投放复盘口径','投产比不等于利润；预算调整要同时看退款和贡献利润。'),('库存检查','可售天数低于7天优先跟踪到仓，避免活动承接断档。'),('Agent回写规范','结果摘要写进待办备注；只有验证成功后才完成任务。'),('客服回复模板','感谢您的反馈，我们已记录问题并安排核查，将尽快同步处理进度。'),('活动验收清单','页面、价格、库存、预算和客服口径全部核对后再上线。')]
        for i in range(18):
            title,content=memos[i%6]
            self.add(Memo(title=PREFIX+title+(f' · 第{i//6+1}版' if i>=6 else ''),content=content+('\n'+MARK if LABELED else ''),category=PREFIX+['运营要点','协作话术','复盘摘录'][i%3],color=['default','yellow','green','blue','pink','purple'][i%6],version=1+i%4,created_at=stamp(START+timedelta(days=i*15)),updated_at=stamp(END-timedelta(days=i%9))))
    def content_and_history(self):
        self.table('content','内容运营记录',[('日期','date'),('账号','short_text'),('平台','select',['小红书','抖音','视频号']),('选题','short_text'),('内容类型','select',['短视频','图文','直播切片']),('曝光量','number'),('互动量','number'),('引导订单','number'),('状态','select',['已发布','已复盘'])])
        topics=['小户型收纳前后对比','厨房台面整理技巧','清洁工具使用演示','旅行收纳清单','新品实测与常见问题','用户场景好物组合']
        for i in range(156):
            day=START+timedelta(days=round(i*364/155))
            for j,platform in enumerate(['小红书','抖音','视频号']):
                exposure=round(RNG.lognormvariate(9+.3*j,.75)*(1+.5*i/155))
                self.record('content',{'日期':day.isoformat(),'账号':['生活研究所','收纳实验室','好物日记'][j],'平台':platform,'选题':topics[i%6],'内容类型':'图文' if j==0 else '短视频' if i%3 else '直播切片','曝光量':str(exposure),'互动量':str(round(exposure*RNG.uniform(.015,.06))),'引导订单':str(round(exposure*RNG.uniform(.0003,.0018))),'状态':'已复盘' if day<END-timedelta(days=7) else '已发布'},day)
        phrases=[('折叠收纳箱，适用于衣柜与小户型空间。','Foldable storage box for wardrobes and compact living spaces.'),('请确认本次活动的价格、库存和发货时效。','Please confirm the campaign pricing, inventory, and dispatch times.'),('我们已完成数据核对，将继续跟进异常原因。','We have verified the data and will continue investigating the exceptions.'),('便携洗漱包，分区收纳，出行更方便。','A compact toiletry bag with organized compartments for easier travel.'),('请提供修改后的素材和对应的效果数据。','Please share the revised creative and its performance data.'),('感谢您的反馈，我们会尽快处理。','Thank you for your feedback. We will resolve this as soon as possible.')]
        for i in range(96):
            cn,en=phrases[i%6]; day=START+timedelta(days=round(i*364/95))
            self.add(TranslationHistory(source_text=(PREFIX+cn+'\n'+MARK) if LABELED else cn,target_text=en,provider='deepseek',model='模拟数据，未调用API' if LABELED else 'deepseek-chat',mode='faithful',duration_ms=0,created_at=stamp(day,11)))
        for i,(cn,en) in enumerate(phrases):
            self.add(TranslationFavorite(source_text=(PREFIX+cn+'\n'+MARK) if LABELED else cn,target_text=en,provider='deepseek',model='模拟数据，未调用API' if LABELED else 'deepseek-chat',created_at=stamp(END-timedelta(days=i*10))))
        token=self.add(AgentToken(user_id=self.user.id,name=PREFIX+'运营回写助手（已停用）',token_hash=hashlib.sha256(secrets.token_bytes(32)).hexdigest(),prefix='wb_agent_DEMO' if LABELED else 'wb_agent_ops',scopes=['tables:read','tables:write','todos:read','todos:write'],created_at=stamp(START+timedelta(days=60)),expires_at=stamp(END,22),last_used_at=stamp(END,18),revoked_at=stamp(END,22)))
        self.db.flush()
        records=self.entities['data_records']
        for i in range(120):
            day=START+timedelta(days=70+int(i*294/119))
            r=RNG.choice([r for r in records if r.created_at<=stamp(day,18)])
            self.add(AgentActivity(token_id=token.id,method='PATCH',path=f'/api/v1/agent/records/{r.id}',created_at=stamp(day,18)))
    def bookmarks(self):
        categories={name:self.add(BookmarkCategory(name=PREFIX+name)) for name in ['运营后台','数据工具','内容平台','学习资料','协作工具']}
        self.db.flush()
        specs=[
            ('运营后台','天猫商家中心','https://myseller.taobao.com/','查看店铺经营、订单与活动报名'),
            ('运营后台','抖音电商罗盘','https://compass.jinritemai.com/','直播与短视频成交、流量和人群分析'),
            ('运营后台','京东商家后台','https://shop.jd.com/','商品、订单、库存与售后处理'),
            ('运营后台','拼多多商家后台','https://mms.pinduoduo.com/','活动报名、推广与发货管理'),
            ('数据工具','生意参谋','https://sycm.taobao.com/','店铺流量、转化与竞争分析'),
            ('数据工具','巨量算数','https://trendinsight.oceanengine.com/','行业趋势、关键词与内容热点'),
            ('内容平台','小红书创作中心','https://creator.xiaohongshu.com/','笔记发布、数据与选题灵感'),
            ('内容平台','视频号助手','https://channels.weixin.qq.com/','视频号内容发布与直播管理'),
            ('学习资料','阿里妈妈营销学院','https://www.alimama.com/','投放方法与活动策略学习'),
            ('学习资料','淘宝大学','https://daxue.taobao.com/','电商运营课程与案例'),
            ('协作工具','飞书','https://www.feishu.cn/','团队文档、表格与周会协作'),
            ('协作工具','Notion','https://www.notion.so/','复盘模板与知识库整理'),
            ('协作工具','稿定设计','https://www.gaoding.com/','活动主图、详情页与内容素材'),
            ('数据工具','快递100','https://www.kuaidi100.com/','物流时效查询与异常件跟进'),
            ('运营后台','微信公众平台','https://mp.weixin.qq.com/','公众号内容与用户消息管理'),
        ]
        for i,(category,title,url,description) in enumerate(specs):
            day=START+timedelta(days=18+i*23)
            self.add(Bookmark(
                title=PREFIX+title,url=url,category=categories[category].name,icon_url='',description=description,
                created_at=stamp(day,10),updated_at=stamp(min(day+timedelta(days=RNG.randint(0,30)),END),15),
            ))

    def run(self):
        self.user=self.db.scalar(select(User).order_by(User.id).limit(1))
        assert self.user,'The local workspace must already have an administrator'
        self.business(); self.products(); self.campaigns(); self.exceptions(); self.checkins(); self.todos(); self.notes_and_memos(); self.content_and_history(); self.bookmarks()
        self.db.flush()
        result=aggregate(self.db,[Widget.model_validate(w) for w in self.entities['dashboards'][0].widgets],DateRange())
        assert all(r['status']=='ok' for r in result),result
        expected=sum(Decimal(t['净销售额']) for t in self.totals.values())
        assert Decimal(result[0]['value'])==expected
        return {'marker':MARK,'labeled':LABELED,'state':'prepared','from':START.isoformat(),'to':END.isoformat(),'created_at':NOW.isoformat(),'tables':{code:{'id':t.id,'marker_key':keys.get('数据标识')} for code,(t,_,keys) in self.tables.items()},'boards':self.boards,'totals':self.totals,'entities':{name:[o.id for o in objects] for name,objects in self.entities.items()},'counts':{name:len(objects) for name,objects in self.entities.items()}}

def summary(manifest):
    print(json.dumps({k:manifest[k] for k in ('marker','state','from','to','counts','boards') if k in manifest},ensure_ascii=False,indent=2))

def remove(manifest):
    assert args.confirm==manifest['marker'],'Pass --confirm '+manifest['marker']+' to remove this dataset'
    ids=manifest['entities']; marker=manifest['marker']; kept=[]
    labeled=manifest.get('labeled',True); prefix=PREFIX if labeled else ''
    if not labeled:
        print('WARNING: --unlabeled data has no marker column; removal deletes the manifest rows even if they were edited later. Back up first.')
    def named(obj): return (not labeled) or (obj.name or '').startswith(prefix)
    def marked(text): return (not labeled) or (marker in (text or ''))
    with SessionLocal.begin() as db:
        for obj in db.scalars(select(Dashboard).where(Dashboard.id.in_(ids.get('dashboards',[])))):
            if named(obj): db.delete(obj)
        db.flush()
        for code,info in manifest['tables'].items():
            table=db.get(DataTable,info['id'])
            if table is None or not marked(table.note): continue
            marker_key=info.get('marker_key')
            for record in db.scalars(select(DataRecord).where(DataRecord.table_id==table.id)):
                if record.id in set(ids['data_records']) and (not labeled or (marker_key and record.data.get(marker_key)==marker)): db.delete(record)
            db.flush()
            referenced=any(any(w.get('table_id')==table.id for w in b.widgets) for b in db.scalars(select(Dashboard)))
            if db.scalar(select(func.count()).select_from(DataRecord).where(DataRecord.table_id==table.id)) or referenced: kept.append(table.name)
            else: db.delete(table)
        todo_ids=set(ids.get('todos',[]))
        for parent_phase in (False,True):
            for obj in db.scalars(select(Todo).where(Todo.id.in_(todo_ids))):
                if bool(obj.parent_id)==parent_phase or not marked(obj.note): continue
                children=list(db.scalars(select(Todo).where(Todo.parent_id==obj.id)))
                if children: kept.append(obj.title)
                else: db.delete(obj)
            db.flush()
        for obj in db.scalars(select(TodoList).where(TodoList.id.in_(ids.get('todo_lists',[])))):
            if named(obj) and not db.scalar(select(func.count()).select_from(Todo).where(Todo.list_id==obj.id)): db.delete(obj)
        for obj in db.scalars(select(Note).where(Note.id.in_(ids.get('notes',[])))):
            if marked(obj.content): db.delete(obj)
        db.flush()
        for obj in db.scalars(select(NoteFolder).where(NoteFolder.id.in_(ids.get('note_folders',[])))):
            if named(obj) and not db.scalar(select(func.count()).select_from(Note).where(Note.folder_id==obj.id)): db.delete(obj)
        for obj in db.scalars(select(NoteTag).where(NoteTag.id.in_(ids.get('note_tags',[])))):
            if named(obj) and not db.scalar(select(func.count()).select_from(NoteTagLink).where(NoteTagLink.tag_id==obj.id)): db.delete(obj)
        for obj in db.scalars(select(Memo).where(Memo.id.in_(ids.get('memos',[])))):
            if marked(obj.content): db.delete(obj)
        for obj in db.scalars(select(Bookmark).where(Bookmark.id.in_(ids.get('bookmarks',[])))):
            if (not labeled) or obj.title.startswith(prefix): db.delete(obj)
        db.flush()
        for obj in db.scalars(select(BookmarkCategory).where(BookmarkCategory.id.in_(ids.get('bookmark_categories',[])))):
            if named(obj) and not db.scalar(select(func.count()).select_from(Bookmark).where(Bookmark.category==obj.name)): db.delete(obj)
        for obj in db.scalars(select(WorkTarget).where(WorkTarget.id.in_(ids.get('work_targets',[])))):
            if not marked(obj.note): continue
            rules=list(db.scalars(select(CheckinRule).where(CheckinRule.target_id==obj.id)))
            if any(r.id not in ids['checkin_rules'] for r in rules): kept.append(obj.name); continue
            for rule in rules: db.delete(rule)
            db.flush()
            db.execute(delete(ActivityInterval).where(ActivityInterval.target_id==obj.id))
            db.delete(obj)
        db.flush()
        for obj in db.scalars(select(CheckinGroup).where(CheckinGroup.id.in_(ids.get('checkin_groups',[])))):
            if named(obj) and not db.scalar(select(func.count()).select_from(CheckinRule).where(CheckinRule.group_id==obj.id)): db.delete(obj)
        for cls,name in [(TranslationHistory,'translation_history'),(TranslationFavorite,'translation_favorites')]:
            for obj in db.scalars(select(cls).where(cls.id.in_(ids.get(name,[])))):
                if marked(obj.source_text): db.delete(obj)
        for obj in db.scalars(select(AgentToken).where(AgentToken.id.in_(ids.get('agent_tokens',[])))):
            if named(obj) and obj.revoked_at: db.delete(obj)
    manifest['state']='partially_removed' if kept else 'removed'; manifest['retained_modified_objects']=kept; save_manifest(manifest); summary(manifest)

if args.action=='status':
    summary(json.loads(MANIFEST.read_text())) if MANIFEST.exists() else print('No simulated year dataset installed')
elif args.action=='remove':
    assert MANIFEST.exists(),'No manifest found; nothing removed'
    remove(json.loads(MANIFEST.read_text()))
else:
    if args.preview:
        Base.metadata.create_all(engine); bootstrap()
    if MANIFEST.exists():
        manifest=json.loads(MANIFEST.read_text())
        if manifest.get('state')!='removed':
            print('Dataset already registered; no duplicate data added'); summary(manifest); sys.exit(0)
    expected_tables=['全店经营日报',*[p[1]+' · 经营日报' for p in PROFILES],'商品与库存台账','推广活动复盘','经营异常与改善跟进','内容运营记录']
    with SessionLocal() as db:
        duplicate=db.scalar(select(DataTable.id).where(DataTable.note.contains(MARK)).limit(1)) if LABELED else db.scalar(select(DataTable.id).where(DataTable.name.in_(expected_tables)).limit(1))
        assert not duplicate,'Dataset marker already exists; refusing duplicate seed'
        builder=Seeder(db)
        manifest=builder.run()
        save_manifest(manifest)
        db.commit()
    manifest['state']='seeded'; save_manifest(manifest); summary(manifest)
