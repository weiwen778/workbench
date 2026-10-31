"""Bounded XLSX interchange for the independent workbook (no macros or drawings)."""
from __future__ import annotations
import io,json,uuid,zipfile,xml.etree.ElementTree as ET
from datetime import datetime,date,time
from decimal import Decimal
from urllib.parse import quote
from fastapi import APIRouter,Depends,UploadFile,File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..config import settings
from .tables import _get_table

router=APIRouter(tags=['Workbook files'],dependencies=[Depends(get_current_user)])

def fail(message):raise ApiError('INVALID_WORKBOOK_FILE',message,422)
def rgb(color):
    if color and color.type=='rgb' and isinstance(color.rgb,str):return '#'+color.rgb[-6:]

def import_xlsx(content:bytes,name:str):
    from openpyxl import load_workbook
    from openpyxl.utils.datetime import to_excel
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries=archive.infolist()
            if len(entries)>5000 or sum(e.file_size for e in entries)>32_000_000 or any(e.file_size>16_000_000 for e in entries):fail('Excel 展开后超过大小限制')
            for e in entries:
                if e.filename.endswith('styles.xml') and e.file_size>2_000_000:fail('Excel 样式数量过多')
            cell_count=0;merge_cells=0
            for path in archive.namelist():
                if path.startswith('xl/worksheets/sheet') and path.endswith('.xml'):
                    with archive.open(path) as f:
                        for _,element in ET.iterparse(f,events=['end']):
                            if element.tag.endswith('}c'):
                                cell_count+=1
                                if cell_count>100000:fail('Excel 最多包含 100000 个非空单元格')
                            if element.tag.endswith('}mergeCell'):
                                from openpyxl.utils.cell import range_boundaries
                                a,b,c,d=range_boundaries(element.attrib.get('ref',''))
                                area=(c-a+1)*(d-b+1);merge_cells+=area
                                if a<1 or b<1 or c>1000 or d>100000 or area>10000 or merge_cells>100000:fail('合并区域超过大小限制')
                            element.clear()
        book=load_workbook(io.BytesIO(content),read_only=False,data_only=False,keep_links=False)
        try:
            if len(book.worksheets)>30:fail('Excel 最多 30 张工作表')
            data={'id':uuid.uuid4().hex,'name':name[:100],'sheetOrder':[],'sheets':{},'styles':{}}
            for ws in book.worksheets:
                if ws.max_row>100000 or ws.max_column>1000:fail('工作表最多 100000 行、1000 列')
                sid=uuid.uuid4().hex;data['sheetOrder'].append(sid)
                sheet={'id':sid,'name':ws.title,'rowCount':min(100000,max(1000,ws.max_row+100)),'columnCount':min(1000,max(26,ws.max_column+10)),'cellData':{},'mergeData':[],'columnData':{},'rowData':{}}
                for cell in ws._cells.values():
                    if cell.value is None and not cell.has_style:continue
                    value=cell.value;entry={}
                    if cell.data_type=='f':entry={'f':value,'t':2}
                    elif isinstance(value,(datetime,date,time)):
                        entry={'v':to_excel(value,book.epoch),'t':2}
                    elif isinstance(value,bool):entry={'v':value,'t':3}
                    elif isinstance(value,(int,float,Decimal)):entry={'v':value,'t':2}
                    elif value is not None:entry={'v':str(value),'t':1}
                    if cell.has_style:
                        style={'ff':cell.font.name or 'Arial','fs':cell.font.sz or 11,'bl':1 if cell.font.bold else 0,'it':1 if cell.font.italic else 0}
                        if rgb(cell.font.color):style['cl']={'rgb':rgb(cell.font.color)}
                        if cell.fill.fill_type=='solid' and rgb(cell.fill.fgColor):style['bg']={'rgb':rgb(cell.fill.fgColor)}
                        if cell.number_format and cell.number_format!='General':style['n']={'pattern':cell.number_format}
                        if cell.alignment.wrap_text:style['tb']=3
                        if cell.alignment.horizontal in {'left','center','right'}:style['ht']={'left':1,'center':2,'right':3}[cell.alignment.horizontal]
                        key='style'+str(cell.style_id);data['styles'][key]=style;entry['s']=key
                    sheet['cellData'].setdefault(str(cell.row-1),{})[str(cell.column-1)]=entry
                for merged in ws.merged_cells.ranges:sheet['mergeData'].append({'startRow':merged.min_row-1,'endRow':merged.max_row-1,'startColumn':merged.min_col-1,'endColumn':merged.max_col-1})
                if ws.freeze_panes:
                    point=ws[ws.freeze_panes];sheet['freeze']={'xSplit':point.column-1,'ySplit':point.row-1,'startRow':point.row-1,'startColumn':point.column-1}
                for key,dimension in ws.column_dimensions.items():
                    from openpyxl.utils import column_index_from_string
                    sheet['columnData'][str(column_index_from_string(key)-1)]={'w':round((dimension.width or 13)*7)}
                for key,dimension in ws.row_dimensions.items():
                    if dimension.height:sheet['rowData'][str(key-1)]={'h':round(dimension.height*4/3)}
                data['sheets'][sid]=sheet
            if len(json.dumps(data,ensure_ascii=False).encode())>10_000_000:fail('转换后的工作簿超过 10MB')
            return data
        finally:book.close()
    except ApiError:raise
    except Exception:fail('无法读取该 Excel，请使用有效的 .xlsx 文件')

class ExportIn(BaseModel):snapshot:dict

@router.post('/imports/workbook/{table_id}')
def preview_workbook(table_id:int,file:UploadFile=File(...),db:Session=Depends(get_db)):
    _get_table(db,table_id)
    if not (file.filename or '').lower().endswith('.xlsx'):fail('仅支持 .xlsx；宏工作簿请先另存为普通工作簿')
    content=file.file.read(settings.max_upload_bytes+1)
    if len(content)>settings.max_upload_bytes:raise ApiError('FILE_TOO_LARGE','文件超过上传上限',413)
    snapshot=import_xlsx(content,(file.filename or '工作簿').rsplit('.',1)[0])
    return {'snapshot':snapshot,'sheets':len(snapshot['sheets']),'cells':sum(len(row) for s in snapshot['sheets'].values() for row in s['cellData'].values()),'notice':'保留内容、公式、合并单元格、冻结及常用格式；字体、底色和数字格式可保留；宏、图表、图片对象和外部数据连接不导入。'}

@router.post('/tables/{table_id}/workbook/export')
def export_workbook(table_id:int,payload:ExportIn,db:Session=Depends(get_db)):
    from openpyxl import Workbook
    from openpyxl.styles import Font,PatternFill,Alignment
    from openpyxl.utils import get_column_letter
    _get_table(db,table_id);snapshot=payload.snapshot
    from .table_workspaces import bounded
    from .table_workspaces import validate_workbook_snapshot
    validate_workbook_snapshot(snapshot)
    bounded(snapshot,10_000_000);sheets=snapshot.get('sheets',{});order=snapshot.get('sheetOrder',list(sheets))
    if not isinstance(sheets,dict) or not isinstance(order,list) or not 1<=len(order)<=30:fail('工作簿格式不合法')
    book=Workbook();book.remove(book.active);count=0
    try:
        for sid in order:
            sheet=sheets.get(sid)
            if not isinstance(sheet,dict):fail('工作表不存在')
            title=str(sheet.get('name','Sheet'))[:31]
            if any(c in title for c in '[]:*?/\\'):fail('工作表名称包含 Excel 不支持的字符')
            ws=book.create_sheet(title or 'Sheet')
            if not isinstance(sheet.get('cellData',{}),dict):fail('单元格格式不合法')
            for r,row in sheet.get('cellData',{}).items():
                if not str(r).isdigit() or not 0<=int(r)<100000 or not isinstance(row,dict):fail('行坐标不合法')
                for c,entry in row.items():
                    count+=1
                    if count>100000:fail('工作簿超过 100000 个单元格')
                    if not str(c).isdigit() or not 0<=int(c)<1000 or not isinstance(entry,dict):fail('列坐标或单元格不合法')
                    cell=ws.cell(int(r)+1,int(c)+1);value=entry.get('f') or entry.get('v')
                    if value is None and entry.get('p'):
                        value=entry['p'].get('body',{}).get('dataStream','').rstrip('\r\n')
                    if not isinstance(value,(str,int,float,bool,type(None))):fail('单元格值类型不合法')
                    cell.value=value
                    if isinstance(value,str) and not entry.get('f'):cell.data_type='s'
                    style=entry.get('s');style=snapshot.get('styles',{}).get(style,{}) if isinstance(style,str) else style or {}
                    if style:
                        color=lambda v:str(v.get('rgb','#000000')).lstrip('#')[-6:] if isinstance(v,dict) else '000000'
                        cell.font=Font(name=style.get('ff','Arial'),size=style.get('fs',11),bold=style.get('bl')==1,italic=style.get('it')==1,color=color(style.get('cl')))
                        if style.get('bg'):cell.fill=PatternFill('solid',fgColor=color(style['bg']))
                        cell.alignment=Alignment(horizontal={1:'left',2:'center',3:'right'}.get(style.get('ht')),wrap_text=style.get('tb')==3)
                        if isinstance(style.get('n'),dict):cell.number_format=style['n'].get('pattern','General')
            for merged in sheet.get('mergeData',[]):
                if not isinstance(merged,dict):fail('合并区域不合法')
                sr,er,sc,ec=[merged.get(k,0) for k in ['startRow','endRow','startColumn','endColumn']]
                if not all(isinstance(x,int) for x in [sr,er,sc,ec]) or not 0<=sr<=er<100000 or not 0<=sc<=ec<1000 or (er-sr+1)*(ec-sc+1)>10000:fail('合并区域超出范围')
                ws.merge_cells(start_row=sr+1,end_row=er+1,start_column=sc+1,end_column=ec+1)
            freeze=sheet.get('freeze') or {};xs,ys=freeze.get('xSplit',0),freeze.get('ySplit',0)
            if isinstance(xs,int) and isinstance(ys,int) and (xs or ys) and 0<=xs<1000 and 0<=ys<100000:ws.freeze_panes=f'{get_column_letter(xs+1)}{ys+1}'
            for c,info in sheet.get('columnData',{}).items():
                if str(c).isdigit() and int(c)<1000 and isinstance(info,dict) and isinstance(info.get('w'),(int,float)):ws.column_dimensions[get_column_letter(int(c)+1)].width=min(255,max(1,info['w']/7))
            for r,info in sheet.get('rowData',{}).items():
                if str(r).isdigit() and int(r)<100000 and isinstance(info,dict) and isinstance(info.get('h'),(int,float)):ws.row_dimensions[int(r)+1].height=min(409,max(1,info['h']*3/4))
        stream=io.BytesIO();book.save(stream);stream.seek(0)
        name=str(snapshot.get('name','工作簿')).replace('\r','').replace('\n','')[:100]+'.xlsx'
        return StreamingResponse(stream,media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(name)})
    except ApiError:raise
    except Exception:fail('工作簿含不支持的格式，无法导出为 Excel；可导出 JSON 备份保留内容')
    finally:book.close()
