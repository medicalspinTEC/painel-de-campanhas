"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { FilterX, ListFilter } from "lucide-react"

import { SelectField, type OpcaoSelect } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const TODOS = "todos"

const OPCOES_NIVEL: OpcaoSelect[] = [
  { value: TODOS, label: "Todos os níveis" },
  { value: "info", label: "Info" },
  { value: "aviso", label: "Aviso" },
  { value: "erro", label: "Erro" },
  { value: "critico", label: "Crítico" },
]

/**
 * Filtros da aba "Erros do sistema" (nível, origem e período). Cada filtro
 * vira parâmetro de busca na URL e a página (Server Component) refaz a
 * consulta já filtrada — os filtros reduzem o que é BUSCADO no banco, não só
 * o que aparece na tela, então também limitam o que o botão "Exportar JSON"
 * exporta. Os valores iniciais vêm da própria página (que já leu
 * `searchParams`), então este componente não precisa de `useSearchParams`
 * (evita a exigência de um Suspense boundary só para isso).
 */
export function LogsFilters({
  origens,
  valoresIniciais,
}: {
  origens: string[]
  valoresIniciais: { nivel: string; origem: string; de: string; ate: string }
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [nivel, setNivel] = useState(valoresIniciais.nivel)
  const [origem, setOrigem] = useState(valoresIniciais.origem)
  const [de, setDe] = useState(valoresIniciais.de)
  const [ate, setAte] = useState(valoresIniciais.ate)

  const opcoesOrigem: OpcaoSelect[] = [
    { value: TODOS, label: "Todas as origens" },
    ...origens.map((o) => ({ value: o, label: o })),
  ]

  function aplicar() {
    const params = new URLSearchParams()
    if (nivel !== TODOS) params.set("nivel", nivel)
    if (origem !== TODOS) params.set("origem", origem)
    if (de) params.set("de", de)
    if (ate) params.set("ate", ate)
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function limpar() {
    setNivel(TODOS)
    setOrigem(TODOS)
    setDe("")
    setAte("")
    router.push(pathname)
  }

  const temFiltroAtivo = nivel !== TODOS || origem !== TODOS || Boolean(de) || Boolean(ate)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="filtro-nivel">
          Nível
        </label>
        <SelectField id="filtro-nivel" value={nivel} onValueChange={setNivel} opcoes={OPCOES_NIVEL} size="sm" className="w-36" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="filtro-origem">
          Origem
        </label>
        <SelectField id="filtro-origem" value={origem} onValueChange={setOrigem} opcoes={opcoesOrigem} size="sm" className="w-44" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="filtro-de">
          De
        </label>
        <Input id="filtro-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-36" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="filtro-ate">
          Até
        </label>
        <Input id="filtro-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-36" />
      </div>

      <Button size="sm" onClick={aplicar}>
        <ListFilter className="size-4" />
        Filtrar
      </Button>

      {temFiltroAtivo ? (
        <Button size="sm" variant="outline" onClick={limpar}>
          <FilterX className="size-4" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}
