"""Stage business API operations; only a browser-authenticated review can commit them."""
from __future__ import annotations
import asyncio
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import uuid

import httpx
from fastapi.encoders import jsonable_encoder
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.routing import Match

from ..agent_runtime import AgentExecution, AgentSession, execution
from ..config import settings
from ..db import Base
from ..errors import ApiError
from ..utils import iso_z
from ..models import AgentChange, AgentToken, DataRecord, Todo, User, utcnow
from .encryption import encrypt_config, decrypt_config

ROOTS = {
 'search','tasks','activity','todo-lists','todos','tables','fields','records','table-views','table-changes','note-folders','note-tags','notes','memos','bookmarks',
 'dashboards','work-targets','checkin-groups','checkin-rules','checkin-instances','checkin-imports','checkin-statistics',
 'preferences','files','imports','data-transfer-jobs','trash','translations','translation-connections',
 'translation-history','translation-favorites','translation-languages','health',
}
MODULES = {
 'tables': ['data_tables','data_fields','data_records','table_views','table_workbooks','table_changes','file_refs'],
 'notes': ['notes','note_folders','note_tags','note_tag_links','note_revisions','file_refs'],
 'todos': ['todo_lists','todos','trash_entries'],
 'memos': ['memos','memo_categories'],
 'bookmarks': ['bookmarks','bookmark_categories'],
 'dashboards': ['dashboards'],
 'checkins': ['work_targets','checkin_groups','checkin_rules','checkin_rule_versions','checkin_instances','activity_intervals'],
 'files': ['files','file_refs','data_transfer_jobs'],
 'preferences': ['users'],
 'trash': ['trash_entries'],
 'translation': ['translation_connections','translation_history','translation_favorites'],
}
MAX_BYTES = 20_000_000
SECRET = {'password','token','secret','api_key','secret_key','access_key','authorization','config_encrypted','password_hash','token_hash','encryption_key','app_key','app_secret','secretkey','apikey','access_token','refresh_token','encrypted_config'}
REF = re.compile(r'\{\{([A-Za-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)\}\}')


def redact(value):
    if isinstance(value, dict):
        return {k: '••••••' if k.lower() in SECRET else redact(v) for k,v in value.items()}
    if isinstance(value, list): return [redact(v) for v in value]
    return value


def canonical(path):
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or parsed.fragment or not parsed.path.startswith('/'):
        raise ApiError('INVALID_AGENT_PATH','请使用以 / 开头的业务接口相对路径',422)
    clean = unquote(parsed.path)
    if any(part in {'.','..'} for part in clean.split('/')) or '//' in clean or '%' in clean or any(ord(c)<32 for c in clean):
        raise ApiError('INVALID_AGENT_PATH','接口路径不合法',422)
    if clean.startswith('/api/v1/'): clean=clean[7:]
    if clean.split('/')[1] not in ROOTS:
        raise ApiError('AGENT_REVIEW_RESERVED','账号登录、令牌管理和暂存审批只能由用户操作',403)
    return clean + ('?'+parsed.query if parsed.query else '')


def module(path):
    root=urlsplit(path).path.split('/')[1]
    if root in {'tables','fields','records','table-views','table-changes'}: return 'tables'
    if root in {'note-folders','note-tags','notes'}: return 'notes'
    if root in {'todo-lists','todos'}: return 'todos'
    if root.startswith('checkin') or root=='work-targets': return 'checkins'
    if root in {'files','imports','data-transfer-jobs'}: return 'files'
    if root=='trash': return 'trash'
    if root.startswith('translation'): return 'translation'
    return root


def authorize(token, path, write=False, method=None):
    scope='all:stage' if write else 'all:read'
    if scope in token.scopes: return
    group=module(path)
    legacy=f"{group}:{'write' if write else 'read'}"
    # Legacy grants keep their old scope; all new writes still go through staging.
    if legacy in token.scopes and group in {'tables','todos'}:
        if not write or method!='DELETE' and (group=='todos' or '/records' in path): return
    raise ApiError('AGENT_FORBIDDEN', '此令牌没有全部业务暂存权限' if write else '此令牌没有读取该模块的权限',403)


def route_for(app, method, path):
    from starlette.routing import compile_path
    clean=canonical(path)
    target='/api/v1'+urlsplit(clean).path
    for candidate, methods in app.openapi()['paths'].items():
        if method.lower() in methods and compile_path(candidate)[0].fullmatch(target):
            return methods[method.lower()]
    raise ApiError('AGENT_OPERATION_UNSUPPORTED','该业务接口或请求方法不存在，请查看 /agent/capabilities',404)


def normalize(operation):
    op={**operation,'method':operation['method'].upper(),'path':canonical(operation['path'])}
    path=urlsplit(op['path']).path
    if re.fullmatch(r'/todos/\d+/completion',path) and op['method']=='PUT':
        completed=(op.get('body') or {}).get('completed')
        if not isinstance(completed,bool): raise ApiError('INVALID_COMPLETION','completed 必须为 true 或 false',422)
        op.update(method='POST',path=path.rsplit('/',1)[0]+('/complete' if completed else '/cancel'),body=None)
    return op


def deferred(op):
    path=urlsplit(op['path']).path
    root=path.split('/')[1]
    return root=='tasks' or path.endswith('/export-tasks') or root in {'files','imports','data-transfer-jobs','trash','translations','translation-connections','checkin-imports'} or any(part in path.split('/') for part in ['exports','export','import']) or path.endswith('/metadata')


def involved(operations):
    groups={module(op['path']) for op in operations}
    if groups & {'tables','notes','checkins'}: groups.add('trash')
    if any(module(op['path'])=='trash' for op in operations): groups.update(MODULES)
    if 'files' in groups: groups.update({'tables','notes'})
    return sorted(set(name for group in groups for name in MODULES.get(group,[]) if name in Base.metadata.tables))


def scoped_names(db, operations):
    """Narrow table edits to their actual source instead of scanning every table."""
    names=set(involved(operations))
    scoped={}
    for original in operations:
        path=urlsplit(original['path']).path
        parts=path.strip('/').split('/')
        if '{{' in path or module(path)!='tables':
            if module(path)=='tables': return sorted(names)
            continue
        table_id=None; record_id=None
        if parts[0]=='tables' and len(parts)>1 and parts[1].isdigit(): table_id=int(parts[1])
        elif parts[0] in {'records','fields','table-views','table-changes'} and len(parts)>1 and parts[1].isdigit():
            name={'records':'data_records','fields':'data_fields','table-views':'table_views','table-changes':'table_changes'}[parts[0]]
            table=Base.metadata.tables[name]
            table_id=db.scalar(select(table.c.table_id).where(table.c.id==int(parts[1])))
            if parts[0]=='records': record_id=int(parts[1])
        if table_id is None: return sorted(names)
        for name in MODULES['tables']:
            if record_id and name in {'table_changes','table_workbooks','table_views'}:
                scoped.setdefault(name,set());continue
            if name=='data_tables': spec=f'{name}$id${table_id}'
            elif name=='file_refs': spec=f'{name}$owner_id${record_id}' if record_id else name  # References protect attachment/history bindings.
            elif name=='data_records' and record_id: spec=f'{name}$id${record_id}'
            else: spec=f'{name}$table_id${table_id}'
            scoped.setdefault(name,set()).add(spec)
    for name,specs in scoped.items():
        names.discard(name);names.update(specs)
    return sorted(names)


def fingerprint(db, names, lock=False):
    result={}
    for name in sorted(names,key=lambda value:(0 if value.split("$")[0]=="data_tables" else 1,value)):
        parts=name.split('$');table_name=parts[0]
        table=Base.metadata.tables[table_name]
        # Record values can contain millions of cells; all supported writes advance versions/timestamps.
        cols=[table.c[k] for k in ['id','version','updated_at','deleted_at'] if k in table.c] if table_name in {'data_records','table_workbooks'} else list(table.c)
        stmt=select(*cols).order_by(table.c.id)
        if len(parts)==3: stmt=stmt.where(table.c[parts[1]]==int(parts[2]))
        if lock: stmt=stmt.with_for_update()
        digest=hashlib.sha256()
        for row in db.execute(stmt).yield_per(1000):
            digest.update(json.dumps(jsonable_encoder(dict(row._mapping)),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode())
        result[name]=digest.hexdigest()
    return result


def resolve(value, results):
    def lookup(ref):
        bits=ref.split('.')
        if bits[0] not in results: raise ApiError('INVALID_CHANGE_REFERENCE','引用了尚未创建的操作结果：'+ref,422)
        node=results[bits[0]]
        try:
            for bit in bits[1:]: node=node[int(bit)] if isinstance(node,list) else node[bit]
        except (KeyError,IndexError,TypeError,ValueError): raise ApiError('INVALID_CHANGE_REFERENCE','操作结果引用不存在：'+ref,422)
        return node
    if isinstance(value,str):
        match=REF.fullmatch(value)
        if match: return lookup(match[1])
        return REF.sub(lambda m:str(lookup(m[1])),value)
    if isinstance(value,list): return [resolve(v,results) for v in value]
    if isinstance(value,dict): return {str(resolve(k,results)):resolve(v,results) for k,v in value.items()}
    return value


def before_value(db, op):
    parts=urlsplit(op['path']).path.strip('/').split('/')
    maps={'tables':'data_tables','fields':'data_fields','records':'data_records','notes':'notes','note-folders':'note_folders',
          'todos':'todos','todo-lists':'todo_lists','memos':'memos','bookmarks':'bookmarks','dashboards':'dashboards',
          'work-targets':'work_targets','checkin-groups':'checkin_groups','checkin-rules':'checkin_rules','checkin-instances':'checkin_instances'}
    if len(parts)<2 or not parts[1].isdigit() or parts[0] not in maps: return None
    table=Base.metadata.tables[maps[parts[0]]]
    row=db.execute(select(table).where(table.c.id==int(parts[1]))).first()
    return redact(jsonable_encoder(dict(row._mapping))) if row else None


async def dispatch(app, db, user_id, actor, operation):
    op=normalize(operation)
    body=op.get('body')
    path=urlsplit(op['path']).path
    if op['method'] in {'PATCH','PUT'} and re.fullmatch(r'/(todos|records)/\d+',path):
        version=body.get('version') if isinstance(body,dict) else None
        if not isinstance(version,int) or isinstance(version,bool) or version<1:
            raise ApiError('VALIDATION_ERROR','修改待办或表格记录必须提供读取到的 version',422)
        model=Todo if path.startswith('/todos/') else DataRecord
        current=db.get(model,int(path.split('/')[-1]))
        if current is not None and current.version!=version:
            raise ApiError('VERSION_CONFLICT','内容已改变，请重新读取并核对后提交暂存',409)
    # Preserve the old Agent PATCH contract: merge fields rather than replacing the record.
    if op['method']=='PATCH' and re.fullmatch(r'/records/\d+',path):
        record=db.get(DataRecord,int(path.split('/')[-1]))
        if record is None: raise ApiError('NOT_FOUND','表格记录不存在',404)
        body={**(body or {}),'data':{**(record.data or {}),**((body or {}).get('data') or {})}}
        op['method']='PUT'
    route_for(app,op['method'],op['path'])
    context=execution.set(AgentExecution(user_id=user_id,actor=actor,db=db))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://agent.internal',timeout=180) as client:
            if op.get('upload'):
                upload=op['upload'];blob=Path(upload['path'])
                # The path is generated by the gateway, never accepted in JSON from an Agent.
                root=(settings.storage_dir/'agent-staging').resolve()
                if blob.resolve().parent!=root: raise ApiError('INVALID_UPLOAD','暂存文件路径不合法',422)
                with blob.open('rb') as file:
                    response=await client.request(op['method'],'/api/v1'+op['path'],files={'file':(upload['name'],file,upload['content_type'])},data=op.get('form') or {})
            else:
                response=await client.request(op['method'],'/api/v1'+op['path'],json=body) if body is not None else await client.request(op['method'],'/api/v1'+op['path'])
        if response.status_code>=400:
            try: details=response.json()
            except ValueError: details={'message':'业务操作失败，HTTP '+str(response.status_code)}
            raise ApiError(details.get('code','AGENT_OPERATION_FAILED'),details.get('message','业务操作失败'),response.status_code,details.get('details',{}))
        return response
    finally:
        execution.reset(context)


LABELS={'title':'标题','name':'名称','content':'正文','note':'说明','category':'分类','color':'颜色','due_date':'截止日期','due_time':'截止时间','completed_at':'完成时间','list_id':'所属清单','parent_id':'父任务','folder_id':'所属文件夹','url':'网址','enabled':'启用状态','sort_mode':'排序方式','kind':'类型','fields':'字段设置','widgets':'图表配置','data':'记录内容','config':'配置','unit':'单位'}
MODULE_LABELS={'tables':'表格','todos':'待办','notes':'笔记','memos':'便利贴','bookmarks':'书签','dashboards':'看板','checkins':'打卡','files':'文件','translation':'翻译','trash':'回收站','preferences':'个人偏好','tasks':'后台任务'}

def describe(db,op,before,after):
    action={'POST':'新增或执行','PUT':'更新','PATCH':'修改','DELETE':'删除'}.get(op['method'],op['method'])
    title=(after or {}).get('title') or (after or {}).get('name') if isinstance(after,dict) else None
    summary=action+MODULE_LABELS.get(module(op['path']),'内容')+(('：'+str(title)) if title else '')
    path=urlsplit(op['path']).path
    if path.endswith('/export-tasks'):summary='提交表格导出任务'
    elif path.endswith('/confirm-tasks'):summary='提交表格导入任务'
    elif module(path)=='tasks' and path.endswith('/cancel'):summary='取消后台任务'
    elif module(path)=='tasks' and path.endswith('/retry'):summary='重新提交后台任务'
    elif path.endswith('/complete'):summary='标记完成'+MODULE_LABELS.get(module(path),'内容')
    elif path.endswith('/undo'):summary='撤销表格变更'
    body=op.get('body') or {};changes=[]
    if isinstance(body,dict):
        old=(before or {}).get('data',{}) if 'data' in body else before or {}
        new=(after or {}).get('data',{}) if 'data' in body else after or {}
        values=body.get('data') if 'data' in body else body
        fields={}
        if 'data' in body:
            from ..models import DataField
            table_id=(before or {}).get('table_id') or (after or {}).get('table_id')
            if table_id:fields={f.key:f for f in db.scalars(select(DataField).where(DataField.table_id==table_id))}
        if isinstance(values,dict):
            for key,value in redact(values).items():
                if key in {'version','request_id','request_key'}:continue
                label=fields[key].name if key in fields else LABELS.get(key,key)
                previous=old.get(key) if isinstance(old,dict) else None
                current=new.get(key,value) if isinstance(new,dict) else value
                if previous!=current:changes.append({'label':label,'before':previous,'after':current})
    return {'summary':summary,'changes':changes,'irreversible':deferred(op)}


async def preview(app, user_id, actor, operations, bind):
    previews=[];results={};names=involved(operations)
    with AgentSession(bind=bind,autoflush=False,expire_on_commit=False) as sandbox:
        baseline=await asyncio.to_thread(lambda:fingerprint(sandbox,scoped_names(sandbox,operations)))
        try:
            for i, original in enumerate(operations):
                op=normalize(resolve(original,results))
                if '{{' not in op['path']: route_for(app,'PUT' if op['method']=='PATCH' and re.fullmatch(r'/records/\d+',urlsplit(op['path']).path) else op['method'],op['path'])
                before=before_value(sandbox,op)
                if deferred(op):
                    previews.append({'method':op['method'],'path':op['path'],'before':before,'request':redact(op.get('body')),
                        'upload':{'name':op['upload']['name'],'size':op['upload']['size']} if op.get('upload') else None,
                        'after':None,'deferred':True,'note':'涉及文件或外部服务：合并时执行，暂存阶段不执行副作用。'})
                    if len(operations)>1: raise ApiError('DEFERRED_BATCH_UNSUPPORTED','文件、导入导出、永久清理和外部服务操作请单独提交暂存',422)
                    continue
                response=await dispatch(app,sandbox,user_id,actor,op)
                after=response.json()
                results[op.get('ref') or f'op{i}']=after
                previews.append({'method':op['method'],'path':op['path'],'before':before,'request':redact(op.get('body')),'after':redact(after),'deferred':False})
            for op,item in zip(operations,previews):item.update(describe(sandbox,op,item['before'],item['after']))
        finally:
            sandbox.rollback()
    return baseline,previews


def change_payload(change, name=None):
    return {'id':change.id,'agent_name':name,'title':change.title,'status':change.status,'version':change.version,
        'preview':change.preview,'results':change.results,'error':change.error,'created_at':iso_z(change.created_at),
        'reviewed_at':iso_z(change.reviewed_at),'reviewed_by':change.reviewed_by,'operation_count':len(change.preview),
        'related_change_ids':[item['change_id'] for item in (change.results or []) if 'change_id' in item] if change.status=='split' else [],'review_note':getattr(change,'review_note',None),'business_data_changed':change.status=='applied','message':'仅已暂存，尚未修改正式数据' if change.status=='pending' else '已合并' if change.status=='applied' else '已拆分，原批次没有执行，请分别查看关联暂存' if change.status=='split' else '已拒绝'}


def decode_operations(change):
    return decrypt_config(change.operations_cipher)['operations']


def cleanup_uploads(operations):
    root=(settings.storage_dir/'agent-staging').resolve()
    for op in operations:
        if op.get('upload'):
            path=Path(op['upload']['path'])
            if path.resolve().parent==root:
                try: path.unlink(missing_ok=True)
                except OSError: pass  # Approval has committed; cleanup must not turn success into a retry.