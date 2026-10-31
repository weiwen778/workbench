"""Bounded, non-executable column expressions and request-local record resolution."""
from __future__ import annotations
import ast, re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import date
from sqlalchemy import select, func
from ..models import DataField, DataRecord, DataTable
from ..errors import ApiError

COMPUTED = {'formula', 'lookup', 'rollup'}
EXTENDED = COMPUTED | {'reference'}
MAX_ROWS = 10000

def error(message):
    raise ApiError('INVALID_FIELD_CONFIG', message, 422)

def expression_tree(expression, bindings):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 1000:
        error('公式需要 1–1000 个字符')
    source = re.sub(r'\{([^{}]+)\}', lambda m: 'F('+repr(bindings.get(m[1], m[1]))+')', expression.lstrip('='))
    try: tree = ast.parse(source, mode='eval')
    except (SyntaxError, ValueError, RecursionError): error('公式语法不正确')
    nodes = list(ast.walk(tree))
    allowed = (ast.Expression, ast.Constant, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.Call, ast.Name, ast.Load,
               ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or,
               ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.IfExp)
    functions = {'F','SUM','AVG','MIN','MAX','COUNT','ROUND','ABS','IF','LEN','CONCAT','COALESCE','DATE_DIFF'}
    if len(nodes) > 160: error('公式过于复杂')
    for node in nodes:
        if not isinstance(node, allowed): error('公式包含不支持的运算')
        if isinstance(node, ast.Name) and node.id not in functions and node.id not in {'True','False','None'}: error('未知公式函数')
        if isinstance(node, ast.Constant) and (not isinstance(node.value, (str,int,float,bool,type(None))) or isinstance(node.value,str) and len(node.value)>1000): error('公式常量不合法')
        if isinstance(node,ast.Constant) and isinstance(node.value,(int,float)) and not isinstance(node.value,bool):
            try:number(node.value)
            except Exception:error('公式数值常量无效或超过范围')
        if isinstance(node, ast.Call) and (not isinstance(node.func,ast.Name) or node.func.id not in functions or node.keywords or len(node.args)>50): error('公式函数参数不合法')
        if isinstance(node,ast.Call) and node.func.id=='F' and (len(node.args)!=1 or not isinstance(node.args[0],ast.Constant) or not isinstance(node.args[0].value,str)): error('字段引用不合法')
    return tree

def number(value):
    if value is None or value=='': return Decimal(0)
    if isinstance(value,bool): return Decimal(int(value))
    v = Decimal(str(value))
    if not v.is_finite() or abs(v)>Decimal('1e30'): raise ValueError('数值超出范围')
    return v

def flatten(args):
    return [v for arg in args for v in (arg if isinstance(arg,list) else [arg]) if v is not None and v!='']

def aggregate(values, operation):
    values=flatten(values)
    if operation=='count': return len(values)
    if not values: return Decimal(0) if operation=='sum' else None
    nums=[number(v) for v in values]
    if operation=='sum': return sum(nums,Decimal(0))
    if operation=='avg': return sum(nums,Decimal(0))/len(nums)
    if operation=='min': return min(nums)
    if operation=='max': return max(nums)
    raise ValueError('不支持的汇总')

def evaluate(tree, field):
    budget=[300]
    def run(n):
        budget[0]-=1
        if budget[0]<0: raise ValueError('公式过于复杂')
        if isinstance(n,ast.Expression): return run(n.body)
        if isinstance(n,ast.Constant): return n.value
        if isinstance(n,ast.Name): return {'True':True,'False':False,'None':None}[n.id]
        if isinstance(n,ast.UnaryOp):
            v=run(n.operand)
            return not v if isinstance(n.op,ast.Not) else -number(v) if isinstance(n.op,ast.USub) else number(v)
        if isinstance(n,ast.IfExp): return run(n.body if run(n.test) else n.orelse)
        if isinstance(n,ast.BoolOp):
            for child in n.values:
                value=run(child)
                if isinstance(n.op,ast.And) and not value or isinstance(n.op,ast.Or) and value: return value
            return value
        if isinstance(n,ast.BinOp):
            a,b=number(run(n.left)),number(run(n.right))
            if isinstance(n.op,ast.Add): value=a+b
            elif isinstance(n.op,ast.Sub): value=a-b
            elif isinstance(n.op,ast.Mult): value=a*b
            elif isinstance(n.op,ast.Div): value=a/b
            else: value=a%b
            return number(value)
        if isinstance(n,ast.Compare):
            a=run(n.left)
            for op,node in zip(n.ops,n.comparators):
                b=run(node)
                try: left,right=number(a),number(b)
                except Exception: left,right=str(a or ''),str(b or '')
                ok=left==right if isinstance(op,ast.Eq) else left!=right if isinstance(op,ast.NotEq) else left>right if isinstance(op,ast.Gt) else left>=right if isinstance(op,ast.GtE) else left<right if isinstance(op,ast.Lt) else left<=right
                if not ok:return False
                a=b
            return True
        name=n.func.id
        if name=='F': return field(run(n.args[0]))
        if name=='IF':
            if len(n.args)!=3:raise ValueError('IF 需要三个参数')
            return run(n.args[1] if run(n.args[0]) else n.args[2])
        args=[run(a) for a in n.args]
        if name in {'SUM','AVG','MIN','MAX','COUNT'}: return aggregate(args,name.lower())
        if name=='ROUND':
            digits=int(number(args[1])) if len(args)>1 else 0
            if abs(digits)>6:raise ValueError('ROUND 小数位范围 -6 至 6')
            return number(args[0]).quantize(Decimal(10)**-digits,rounding=ROUND_HALF_UP)
        if name=='ABS':return abs(number(args[0]))
        if name=='LEN':return len('' if args[0] is None else str(args[0]))
        if name=='CONCAT':return ''.join('' if a is None else str(a) for a in args)[:20000]
        if name=='COALESCE':return next((a for a in args if a is not None and a!=''),None)
        if name=='DATE_DIFF':return (date.fromisoformat(str(args[0])[:10])-date.fromisoformat(str(args[1])[:10])).days
        raise ValueError('未知公式')
    return run(tree)

def configure(db, field, fields):
    config=dict(field.config or {})
    if field.type=='formula':
        names={f.name:f.key for f in fields};keys={f.key for f in fields}
        saved=config.get('bindings',{})
        if not isinstance(saved,dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in saved.items()):error('公式字段绑定不合法')
        bindings={**names,**{k:k for k in keys},**saved}
        tree=expression_tree(config.get('expression'),bindings)
        refs={n.args[0].value for n in ast.walk(tree) if isinstance(n,ast.Call) and n.func.id=='F'}
        if not refs<=keys:error('公式引用了不存在的列')
        if field.key in refs:error('公式不能引用自己')
        config['bindings']=bindings
        # Column dependency cycles are rejected before saving, not on every edit.
        graph={f.key:set() for f in fields}
        for f in fields:
            if f.type=='formula':
                c=config if f.key==field.key else f.config or {}
                t=expression_tree(c.get('expression'),c.get('bindings',bindings))
                graph[f.key]={n.args[0].value for n in ast.walk(t) if isinstance(n,ast.Call) and n.func.id=='F'}
        visited=set()
        def visit(key,path):
            if key in path:error('公式存在循环引用')
            if key in visited:return
            for dependency in graph.get(key,[]):visit(dependency,path|{key})
            visited.add(key)
        for k in graph:visit(k,set())
    elif field.type=='reference':
        tid=config.get('table_id');t=db.get(DataTable,tid) if isinstance(tid,int) and not isinstance(tid,bool) else None
        if not t or t.deleted_at is not None:error('关联表不存在')
        if t.kind=='virtual':error('关联记录请选择原始表，虚拟表没有可回写的原始记录')
        target_fields=list(db.scalars(select(DataField).where(DataField.table_id==tid)))
        if config.get('label_field') not in {f.key for f in target_fields}:error('请选择关联表的显示列')
        config['multiple']=bool(config.get('multiple',False))
    elif field.type in {'lookup','rollup'}:
        ref=next((f for f in fields if f.key==config.get('reference_field') and f.type=='reference'),None)
        if not ref:error('请选择本表的一列关联字段')
        tf=db.scalar(select(DataField).where(DataField.table_id==(ref.config or {}).get('table_id'),DataField.key==config.get('target_field')))
        if not tf:error('查找列不存在')
        if field.type=='rollup' and config.get('operation','sum') not in {'sum','avg','min','max','count'}:error('汇总方式不合法')
    if field.type in COMPUTED and field.required:error('计算列不能设置为必填')
    if field.type not in COMPUTED and field.default_value is not None:
        from .fields import validate_value
        field.default_value=validate_value(db,field,field.default_value,table_id=field.table_id)
    field.config=config

class Resolver:
    def __init__(self,db):self.db=db;self.tables={};self.cache={};self.trees={};self.errors={};self.failures={}
    def table(self,table_id):
        if table_id in self.failures:raise self.failures[table_id]
        if table_id not in self.tables:
            t=self.db.get(DataTable,table_id)
            if not t or t.deleted_at is not None:
                self.failures[table_id]=ValueError('关联表已删除');raise self.failures[table_id]
            if t.kind=='virtual':raise ApiError('INVALID_REFERENCE','关联记录请选择原始表',422)
            fields=list(self.db.scalars(select(DataField).where(DataField.table_id==table_id).order_by(DataField.sort_order,DataField.id)))
            rows=list(self.db.scalars(select(DataRecord).where(DataRecord.table_id==table_id,DataRecord.deleted_at.is_(None)).order_by(DataRecord.id).limit(MAX_ROWS+1)))
            if len(rows)>MAX_ROWS:
                self.failures[table_id]=ApiError('ANALYSIS_LIMIT',f'关联计算与分析单表最多 {MAX_ROWS} 行，请拆分数据',422);raise self.failures[table_id]
            self.tables[table_id]=({f.key:f for f in fields},{r.id:r for r in rows})
        return self.tables[table_id]
    def value(self,record,key,path=frozenset()):
        ident=(record.id,key)
        if ident in path:raise ValueError('循环引用')
        if len(path)>40:raise ValueError('引用层级过深')
        if ident in self.cache:return self.cache[ident]
        fields,_=self.table(record.table_id);f=fields.get(key)
        if not f:raise ValueError('引用的列已删除')
        config=f.config or {};path=path|{ident}
        if f.type=='formula':
            if f.id not in self.trees:self.trees[f.id]=expression_tree(config.get('expression'),config.get('bindings',{}))
            value=evaluate(self.trees[f.id],lambda k:self.value(record,k,path))
        elif f.type in {'lookup','rollup'}:
            ref=fields.get(config.get('reference_field'))
            if not ref:raise ValueError('关联列已删除')
            ids=(record.data or {}).get(ref.key) or [];ids=ids if isinstance(ids,list) else [ids]
            _,records=self.table((ref.config or {}).get('table_id'))
            linked=[]
            for i in ids:
                r=records.get(i) or self.db.get(DataRecord,i)
                if r and r.table_id==(ref.config or {}).get('table_id') and r.deleted_at is None:linked.append(r)
            values=[self.value(r,config.get('target_field'),path) for r in linked]
            value=aggregate(values,config.get('operation','sum')) if f.type=='rollup' else values
        else:value=(record.data or {}).get(key)
        if isinstance(value,Decimal):value=format(value.normalize(),'f')
        if isinstance(value,str) and len(value)>20000:raise ValueError('计算结果过长')
        self.cache[ident]=value;return value
    def payload(self,record):
        fields,_=self.table(record.table_id);data=dict(record.data or {});errors={}
        for f in fields.values():
            if f.type in COMPUTED:
                try:data[f.key]=self.value(record,f.key)
                except Exception as exc:data[f.key]=None;errors[f.key]=getattr(exc,'message',str(exc))[:160]
        from ..utils import iso_z
        return {'id':record.id,'data':data,'version':record.version,'created_at':iso_z(record.created_at),'updated_at':iso_z(record.updated_at),'computed_errors':errors}
