import { clsx } from 'clsx'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

export function Card({ className, padded = true, children, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={clsx('card', padded && 'p-6', className)}
    >
      {children}
    </div>
  )
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  icon?: React.ReactElement
}

export function CardTitle({ className, icon, children, ...props }: CardTitleProps) {
  return (
    <h3 className={clsx('card-title', className)} {...props}>
      {icon && <span className="card-icon">{icon}</span>}
      {children}
    </h3>
  )
}

interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardBody({ className, children, ...props }: CardBodyProps) {
  return <div className={clsx('card-body', className)} {...props}>{children}</div>
}
