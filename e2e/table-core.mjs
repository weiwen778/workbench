// Node 22.18+ / 24: native TypeScript type stripping; no DOM required.
import assert from 'node:assert/strict'
import {parseTSV,toTSV,csvCell,aggregate,queryRows,defaultConfig,parseCell} from '../web/src/table-core.ts'
const matrix=[['0012','含\t制表符','两行\n文字','带"引号'],['2','','末尾','']]
assert.deepEqual(parseTSV(toTSV(matrix)),matrix)
assert.throws(()=>parseTSV('"未闭合'))
assert.equal(aggregate([{id:1,data:{n:'0.1'},version:1},{id:2,data:{n:'0.2'},version:1}],'n','sum'),'0.3')
for(const v of ['=1+2','+SUM(A1:A2)','-cmd|x','@SUM(A1:A2)','\t=1+2'])assert.ok(csvCell(v).startsWith('"\''))
assert.equal(csvCell('-12.50'),'"-12.50"')
assert.equal(csvCell('正常"文本'),'"正常""文本"')
assert.throws(()=>parseCell({key:'f',name:'公式',type:'formula'},'3'))
const fields=[{key:'n',name:'数值',type:'number'}],config=defaultConfig();config.sorts=[{field:'n',order:'asc'}]
assert.deepEqual(queryRows([{id:1,data:{n:'10'},version:1},{id:2,data:{n:'2'},version:1}],fields,config,{}).map(r=>r.id),[2,1])
console.log('PASS: quoted clipboard roundtrip, exact decimal summaries, CSV formula-text escaping, numeric sorting, computed field protection')
