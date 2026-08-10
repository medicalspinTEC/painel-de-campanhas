import type { ReactNode } from "react"

export function PageHeader({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao?: string
  children?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-balance md:text-2xl">{titulo}</h1>
        {descricao ? (
          <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed text-pretty">{descricao}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}
