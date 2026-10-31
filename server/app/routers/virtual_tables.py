"""Read-only computed tables with explicit, versioned source definitions."""
import uuid
from decimal import localcontext
from fastapi import APIRouter,Depends
from pydantic import BaseModel,Field,field_validator
from sqlalchemy import select,func,update
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_current_user
from ..models import DataTable,DataField,utcnow
from ..errors import ApiError
from ..services.virtual_tables import Definition,validate_definition,compute,resolve_table,data_fields,fail
from .tables import table_payload,_lock_table

router=APIRouter(tags=['Virtual tables'],dependencies=[Depends(get_current_user)])
class VirtualIn(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    note:str|None=Field(default=None,max_length=2000)
    definition:Definition
    version:int|None=Field(default=None,ge=1)
    @field_validator('name')
    @classmethod
    def clean(cls,v):
        if not v.strip():raise ValueError('虚拟表名称不能为空')
        return v.strip()
class PreviewIn(BaseModel):
    definition:Definition

def unique_name(db,name,exclude=None):
    if db.scalar(select(DataTable.id).where(DataTable.name==name,DataTable.deleted_at.is_(None),DataTable.id!=exclude if exclude else True)):
        raise ApiError('NAME_DUPLICATED','已有同名表格',409)

def apply_fields(db,table,definition,fields):
    existing={f.key:f for f in data_fields(db,table.id)}
    wanted={f.key for f in fields}
    # Temporarily rename to permit exchanging two output names under unique constraints.
    for key,f in existing.items():
        if key in wanted:f.name='__v_tmp_'+uuid.uuid4().hex
        else:db.delete(f)
    db.flush()
    for position,f in enumerate(fields):
        current=existing.get(f.key)
        if current is None:
            current=DataField(table_id=table.id,key=f.key,name=f.name,type=f.type);db.add(current)
        current.name=f.name;current.type=f.type;current.config=f.config or {};current.sort_order=position;current.required=False;current.options=None;current.default_value=None
    table.virtual_config=definition.model_dump(mode='json')

@router.post('/virtual-tables/preview')
def preview(payload:PreviewIn,db:Session=Depends(get_db)):
    with localcontext() as context:
        context.prec=50
        result=compute(db,payload.definition)
    out=result.payload();out['records']=out['records'][:100];out['preview_limit']=100
    return out

@router.post('/virtual-tables',status_code=201)
def create(payload:VirtualIn,db:Session=Depends(get_db)):
    unique_name(db,payload.name)
    definition,tables,source_fields,fields=validate_definition(db,payload.definition)
    # A save is validated against live data too: no permanently broken initial rule.
    with localcontext() as context:
        context.prec=50;compute(db,definition)
    table=DataTable(name=payload.name,note=payload.note,kind='virtual',sort_order=(db.scalar(select(func.max(DataTable.sort_order))) or 0)+1)
    db.add(table);db.flush();apply_fields(db,table,definition,fields);db.flush();result=table_payload(table,data_fields(db,table.id));db.commit();return result

@router.put('/virtual-tables/{table_id}')
def save(table_id:int,payload:VirtualIn,db:Session=Depends(get_db)):
    table=_lock_table(db,table_id)
    if table.kind!='virtual':fail('此表不是虚拟表')
    if payload.version!=table.schema_version:raise ApiError('VERSION_CONFLICT','虚拟表规则已在其他页面修改，请重新载入；当前输入仍保留',409)
    unique_name(db,payload.name,table.id)
    previous={c['key']:c for c in (table.virtual_config or {}).get('columns',[])}
    for c in payload.definition.columns:
        if c.type=='formula' and previous.get(c.key,{}).get('expression')!=c.expression:c.bindings={}
    definition,tables,source_fields,fields=validate_definition(db,payload.definition)
    with localcontext() as context:context.prec=50;compute(db,definition)
    changed=db.execute(update(DataTable).where(DataTable.id==table_id,DataTable.schema_version==payload.version).values(schema_version=payload.version+1,updated_at=utcnow()))
    if changed.rowcount!=1:raise ApiError('VERSION_CONFLICT','虚拟表规则已变化',409)
    apply_fields(db,table,definition,fields);table.name=payload.name;table.note=payload.note;db.flush();result=table_payload(table,data_fields(db,table.id));db.commit();return result

@router.get('/virtual-tables/{table_id}/data')
def data(table_id:int,db:Session=Depends(get_db)):
    return resolve_table(db,table_id).payload()
