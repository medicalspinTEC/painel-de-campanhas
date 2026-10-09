/**
 * Mostrado na hora ao trocar de página no painel, enquanto o servidor monta a página nova.
 * Sem isto, o clique no menu fica "parado" até a página inteira (e seus dados) ficar pronta.
 * Também é o que o Next pré-carrega dos links do menu, então a troca começa instantaneamente.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Carregando">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border bg-card" />
    </div>
  )
}
