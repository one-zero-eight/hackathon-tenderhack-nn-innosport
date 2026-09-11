import { cn } from '@/lib/cn'
import cva, { type VariantProps } from '@/lib/cva'
import { forwardRef, type InputHTMLAttributes } from 'react'

const inputVariants = cva(
  'block w-full rounded-md border px-3 py-2 text-sm placeholder:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
  {
    variants: {
      intent: {
        default: 'border-gray-300',
        error: 'border-red-500 text-red-700 placeholder-red-300 focus:ring-red-500 focus:border-red-500',
        success: 'border-green-500 text-green-700 placeholder-green-300 focus:ring-green-500 focus:border-green-500',
      },
      size: {
        sm: 'px-2 py-1 text-xs',
        md: 'px-3 py-2 text-sm',
        lg: 'px-4 py-3 text-base',
      },
    },
    default: {
      intent: 'default',
      size: 'md',
    },
  },
)

type InputPropsVariants = VariantProps<typeof inputVariants>
type InputProps = InputHTMLAttributes<HTMLInputElement> & InputPropsVariants

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, intent, size, ...props }, ref) => {
  return <input ref={ref} type="text" className={cn(inputVariants({ intent, size, className }))} {...props} />
})

Input.displayName = 'Input'
export default Input
