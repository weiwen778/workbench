import {ElMessageBox} from 'element-plus'
import {http} from '@/api/client'
export async function renameTable(table:{id:number;name:string}) {
 const {value}=await ElMessageBox.prompt('新的表格名称','重命名表格',{inputValue:table.name,inputValidator:v=>!!v?.trim()&&v.trim().length<=100||'请输入 1–100 个字',confirmButtonText:'保存',cancelButtonText:'取消'})
 await http.patch(`/tables/${table.id}`,{name:value.trim()})
 window.dispatchEvent(new Event('wb:tables-changed'))
}
