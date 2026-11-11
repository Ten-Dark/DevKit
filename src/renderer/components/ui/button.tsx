import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'danger'
}

export function Button({
  className,
  variant = 'default',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type="button"
      disabled={disabled}
      className={cn('btn', `btn-${variant}`, className)}
    />
  )
}
