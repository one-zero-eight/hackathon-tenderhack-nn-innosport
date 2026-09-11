import { useEffect, useState, type ComponentProps } from 'react'
import Input from '../input'
import type { CellContext } from '@tanstack/react-table'

export default function EditableCell<T>({ ...props }: ComponentProps<'input'> & CellContext<T, unknown>) {
  const initialValue = props.getValue() as string
  const [value, setValue] = useState<string>(initialValue)

  const handleBlur = () => {}

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  return (
    <Input
      value={value as unknown as string} // cast for input element
      onChange={(e) => setValue(e.target.value || '')}
      onBlur={handleBlur}
    />
  )
}
