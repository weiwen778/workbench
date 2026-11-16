import { useParams } from 'react-router-dom'
import TableView from '@/components/TableView'

export default function TableRoutePage() {
  const params = useParams()
  return <TableView key={params.tableId} tableId={Number(params.tableId)} />
}
