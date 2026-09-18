"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { FilterX, ListFilter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Filtro de período dos Relatórios (data inicial/final). Vira parâmetro de
 * busca na URL e a página (Server Component) refaz as consultas já
 * filtradas — o período reduz o que é BUSCADO no banco, não só o que
 * aparece na tela, então também limita o que o menu "Exportar relatórios"
 * gera. Sem filtro, os relatórios e a exportação cobrem todo o histórico.
 */
export function ReportsFilters({
  valoresIniciais,
}: {
  valoresIniciais: { de: string; ate: string }
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [de, setDe] = useState(valoresIniciais.de)
  const [ate, setAte] = useState(valoresIniciais.ate)

  function aplicar() {
    const params = new URLSearchParams()
    if (de) params.set("de", de)
    if (ate) params.set("ate", ate)
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function limpar() {
    setDe("")
    setAte("")
    router.push(pathname)
  }

  const temFiltroAtivo = Boolean(de) || Boolean(ate)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="filtro-relatorio-de">
          De
        </label>
        <Input id="filtro-relatorio-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-36" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="filtro-relatorio-ate">
          Até
        </label>
        <Input id="filtro-relatorio-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-36" />
      </div>

      <Button size="sm" onClick={aplicar}>
        <ListFilter className="size-4" />
        Filtrar
      </Button>

      {temFiltroAtivo ? (
        <Button size="sm" variant="outline" onClick={limpar}>
          <FilterX className="size-4" />
          Limpar filtro
        </Button>
      ) : null}
    </div>
  )
}
