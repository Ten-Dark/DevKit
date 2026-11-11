import { clsx } from 'clsx'

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div className={clsx('scroll-area', className)} {...props}>
      {children}
    </div>
  )
}
