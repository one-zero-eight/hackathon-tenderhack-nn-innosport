import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'border-input bg-background text-foreground placeholder:text-foreground/45 focus-visible:ring-primary block w-full resize-none rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
export default Textarea
