import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  leftIcon?: React.ReactElement
}

export function Input({ className, error = false, leftIcon, ...props }: InputProps) {
  return (
    <div className="input-wrapper">
      {leftIcon && <span className="input-icon">{leftIcon}</span>}
      <input
        {...props}
        className={clsx('input', error && 'input-error', className)}
      />
    </div>
  )
}
