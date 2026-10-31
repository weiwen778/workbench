import io,zipfile
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill

def table(auth):return auth.post('/api/v1/tables',json={'name':'Excel 测试','fields':[{'name':'字','type':'short_text'}]}).json()['id']

def test_excel_roundtrip_formulas_merges_formats_and_leading_zero(auth):
    tid=table(auth);wb=Workbook();ws=wb.active;ws.title='格式测试';ws['A1']='00123';ws['B1']=12.5;ws['B1'].number_format='0.00';ws['A2']='=literal text';ws['A2'].data_type='s';ws['C1']='=SUM(B1,2)';ws['A1'].font=Font(bold=True,color='FF223344');ws['A1'].fill=PatternFill('solid',fgColor='FFFBE4E4');ws.merge_cells('A3:B3');ws.freeze_panes='B2';stream=io.BytesIO();wb.save(stream)
    result=auth.post(f'/api/v1/imports/workbook/{tid}',files={'file':('test.xlsx',stream.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')});assert result.status_code==200,result.text
    snapshot=result.json()['snapshot'];sheet=snapshot['sheets'][snapshot['sheetOrder'][0]]
    assert sheet['cellData']['0']['0']['v']=='00123' and sheet['cellData']['0']['2']['f']=='=SUM(B1,2)' and sheet['freeze']['xSplit']==1
    exported=auth.post(f'/api/v1/tables/{tid}/workbook/export',json={'snapshot':snapshot});assert exported.status_code==200,exported.text
    restored=load_workbook(io.BytesIO(exported.content));ws=restored.active
    assert ws['A1'].value=='00123' and ws['C1'].value=='=SUM(B1,2)' and ws['A2'].data_type=='s' and ws['A1'].font.bold and ws['B1'].number_format=='0.00' and str(ws.freeze_panes)=='B2'
    assert 'A3:B3' in {str(r) for r in ws.merged_cells.ranges}

def test_excel_invalid_zip_and_huge_merge_rejected(auth):
    tid=table(auth)
    assert auth.post(f'/api/v1/imports/workbook/{tid}',files={'file':('bad.xlsx',b'no')}).status_code==422
    wb=Workbook();stream=io.BytesIO();wb.save(stream);changed=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as source,zipfile.ZipFile(changed,'w') as dest:
        for name in source.namelist():
            content=source.read(name)
            if name=='xl/worksheets/sheet1.xml':content=content.replace(b'</worksheet>',b'<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>')
            dest.writestr(name,content)
    result=auth.post(f'/api/v1/imports/workbook/{tid}',files={'file':('bad.xlsx',changed.getvalue())});assert result.status_code==422

def test_excel_export_dimension_and_merge_bounds(auth):
    tid=table(auth)
    for sheet in [{'cellData':{'100000':{'0':{'v':'outside'}}}},{'cellData':{},'mergeData':[{'startRow':0,'endRow':99999,'startColumn':0,'endColumn':999}]}]:
        assert auth.post(f'/api/v1/tables/{tid}/workbook/export',json={'snapshot':{'sheetOrder':['x'],'sheets':{'x':sheet}}}).status_code==422
