import { useState } from 'react'
import type { User } from './table-types'
import tableData from './data'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { EditableCell, Table, TableBody, TableCell, TableHead, TableHeader, TableResizer, TableRow } from '@/components/ui/table/table'

export default function TablePreviewPage() {
  const [data, setData] = useState<User[]>(tableData)

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'firstName',
      header: 'First Name',
      cell: EditableCell,
    },
    {
      accessorKey: 'lastName',
      header: 'Last Name',
      cell: EditableCell,
    },
    { accessorKey: 'age', header: 'Age', cell: ({ getValue }) => <p>{getValue<number>()}</p> },
    {
      accessorKey: 'visitedAt',
      header: 'Visited At',
      cell: ({ getValue }) => <p>{getValue<Date | undefined>()?.toLocaleDateString() || ''}</p>,
    },
    { accessorKey: 'progress', header: 'Progress', cell: ({ getValue }) => <p>{getValue<number>()}</p> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <p>{getValue<string>()}</p> },
  ]

  interface TableMeta {
    updateData: (rowIndex: number, columnId: keyof User, value: User[keyof User]) => void
  }

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    meta: {
      updateData: (rowIndex, columnId, value) => {
        setData((prev) => prev.map((row, index) => (index === rowIndex ? { ...row, [columnId]: value } : row)))
      },
    } as TableMeta,
  })

  return (
    <div className="w-min overflow-hidden rounded-md border">
      <Table totalSize={table.getTotalSize()}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} size={header.getSize()}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  <TableResizer onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} className={header.column.getIsResizing() ? 'isResizing' : ''} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="text-left" size={cell.column.getSize()}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
