import { cn } from '@/lib/cn'
import type { ComponentProps } from 'react'
import EditableCell from './editableCell'

function Table({ totalSize, className, ...props }: ComponentProps<'table'> & { totalSize?: number }) {
  return (
    <div data-slot="table-container" className="relative overflow-x-auto" style={{ width: totalSize ? `${totalSize}px` : '100%' }}>
      <table className={cn('caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return <tfoot className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)} {...props} />
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors', className)} {...props} />
}

function TableHead({ size, className, ...props }: ComponentProps<'th'> & { size?: number }) {
  return (
    <th
      className={cn('text-foreground relative h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 *:[[role=checkbox]]:translate-y-0.5', className)}
      style={{ width: size ? `${size}px` : '' }}
      {...props}
    />
  )
}

function TableResizer({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('absolute top-0 right-0 h-full w-0.5 cursor-col-resize touch-none bg-white/50 opacity-0 select-none [&.isResizing]:bg-white [&.isResizing]:opacity-100 [*:hover>&]:opacity-100', className)} {...props} />
}

function TableCell({ size, className, ...props }: ComponentProps<'td'> & { size?: number }) {
  return <td className={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 *:[[role=checkbox]]:translate-y-0.5', className)} style={{ width: size ? `${size}px` : '' }} {...props} />
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('text-muted-foreground mt-4 text-sm', className)} {...props} />
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableResizer, TableRow, TableCell, TableCaption, EditableCell }
