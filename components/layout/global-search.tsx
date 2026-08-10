"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart3, LayoutDashboard, Radio, Search, TriangleAlert, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

export interface SearchItem {
  id: string
  nome: string
  detalhe: string
  href: string
}

const paginas = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Leads", href: "/leads", icon: Users },
  { title: "Campanhas", href: "/campanhas", icon: Radio },
  { title: "Relatórios", href: "/relatorios", icon: BarChart3 },
  { title: "Logs", href: "/logs", icon: TriangleAlert },
]

export function GlobalSearch({ leads, campanhas }: { leads: SearchItem[]; campanhas: SearchItem[] }) {
  const [aberto, setAberto] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setAberto((v) => !v)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const navegar = (href: string) => {
    setAberto(false)
    router.push(href)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground sm:w-64"
        onClick={() => setAberto(true)}
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Pesquisar…</span>
        <kbd className="hidden rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={aberto}
        onOpenChange={setAberto}
        title="Pesquisa global"
        description="Encontre leads, campanhas e telas do sistema."
      >
        <CommandInput placeholder="Buscar leads, campanhas ou telas…" />
        <CommandList>
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
          <CommandGroup heading="Navegação">
            {paginas.map((p) => (
              <CommandItem key={p.href} value={p.title} onSelect={() => navegar(p.href)}>
                <p.icon className="size-4 text-muted-foreground" />
                <span>{p.title}</span>
                <CommandShortcut>Ir</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Leads">
            {leads.map((l) => (
              <CommandItem key={l.id} value={`${l.nome} ${l.detalhe}`} onSelect={() => navegar(l.href)}>
                <Users className="size-4 text-muted-foreground" />
                <span className="truncate">{l.nome}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{l.detalhe}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Campanhas">
            {campanhas.map((c) => (
              <CommandItem key={c.id} value={`${c.nome} ${c.detalhe}`} onSelect={() => navegar(c.href)}>
                <Radio className="size-4 text-muted-foreground" />
                <span className="truncate">{c.nome}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{c.detalhe}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
