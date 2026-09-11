import { forwardRef, type ButtonHTMLAttributes } from 'react'
import cva, { type VariantProps } from '@/lib/cva'
import { cn } from '@/lib/cn'

const buttonVariants = cva('font-semibold text-center rounded-lg cursor-pointer transition-colors duration-100 h-min w-min text-nowrap border select-none', {
  variants: {
    size: { sm: 'text-sm px-3 py-1.5', md: 'text-sm px-4 py-2', lg: 'text-base px-6 py-3', xl: 'text-lg px-8 py-4' },
    variant: { primary: '', outline: 'bg-transparent', ghost: 'bg-transparent border-transparent', disabled: 'bg-secondary text-secondary-foreground border-secondary-foreground cursor-not-allowed' },
    color: { primary: 'primary', success: 'success', warning: 'warning', error: 'error' },
  },
  compoundVariants: [
    { variant: 'primary', color: 'primary', class: 'bg-primary text-primary-foreground border-primary hover:bg-primary/85 hover:border-primary/85 active:bg-primary active:border-primary' },
    { variant: 'primary', color: 'success', class: 'bg-success text-success-foreground border-success hover:bg-success/85 hover:border-success/85 active:bg-success active:border-success' },
    { variant: 'primary', color: 'warning', class: 'bg-warning text-warning-foreground border-warning hover:bg-warning/85 hover:border-warning/85 active:bg-warning active:border-warning' },
    { variant: 'primary', color: 'error', class: 'bg-error text-error-foreground border-error hover:bg-error/85 hover:border-error/85 active:bg-error active:border-error' },
    { variant: 'outline', color: 'primary', class: 'text-primary border-primary hover:bg-primary/10 active:bg-primary/20' },
    { variant: 'outline', color: 'success', class: 'text-success border-success hover:bg-success/10 active:bg-success/20' },
    { variant: 'outline', color: 'warning', class: 'text-warning border-warning hover:bg-warning/10 active:bg-warning/20' },
    { variant: 'outline', color: 'error', class: 'text-error border-error hover:bg-error/10 active:bg-error/20' },
    { variant: 'ghost', color: 'primary', class: 'text-primary hover:bg-primary/10 active:bg-primary/20' },
    { variant: 'ghost', color: 'success', class: 'text-success hover:bg-success/10 active:bg-success/20' },
    { variant: 'ghost', color: 'warning', class: 'text-warning hover:bg-warning/10 active:bg-warning/20' },
    { variant: 'ghost', color: 'error', class: 'text-error hover:bg-error/10 active:bg-error/20' },
  ],
  default: { size: 'md', variant: 'primary', color: 'primary' },
})

type ButtonVariantProps = VariantProps<typeof buttonVariants>
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariantProps

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ children, variant, size, color, className, disabled, ...props }, ref) => {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant: disabled ? 'disabled' : variant, size, color, className }))} {...props}>
      {children}
    </button>
  )
})

Button.displayName = 'Button'
export default Button
