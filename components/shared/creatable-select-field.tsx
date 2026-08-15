"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

import type { OpcaoSelect } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Combobox controlado que permite escolher uma opção existente OU adicionar um
 * novo item digitando. Também envia o valor em formulários via `name`.
 *
 * As dimensões de segmentação (produto, marca, persona, região) são texto livre
 * no banco, então novos itens digitados aqui são gravados normalmente e passam a
 * aparecer como opção nas próximas vezes.
 */
export function CreatableSelectField({
  name,
  value,
  onValueChange,
  opcoes,
  placeholder = "Selecione",
  buscaPlaceholder = "Buscar ou adicionar...",
  size = "default",
  className,
  id,
  ariaInvalid,
  maxLength = 60,
}: {
  name?: string
  value: string
  onValueChange: (value: string) => void
  opcoes: OpcaoSelect[]
  placeholder?: string
  buscaPlaceholder?: string
  size?: "sm" | "default"
  className?: string
  id?: string
  ariaInvalid?: boolean
  maxLength?: number
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")

  const rotuloAtual = useMemo(() => opcoes.find((o) => o.value === value)?.label ?? value, [opcoes, value])

  const termo = busca.trim()
  const filtradas = useMemo(() => {
    if (!termo) return opcoes
    const alvo = termo.toLowerCase()
    return opcoes.filter((o) => o.label.toLowerCase().includes(alvo))
  }, [opcoes, termo])

  // Mostra a ação de adicionar quando o texto digitado não corresponde
  // exatamente a nenhuma opção já existente.
  const existeExato = opcoes.some((o) => o.label.toLowerCase() === termo.toLowerCase())
  const podeAdicionar = termo.length > 0 && !existeExato

  function selecionar(novoValor: string) {
    onValueChange(novoValor)
    setBusca("")
    setAberto(false)
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(next) => {
        setAberto(next)
        if (!next) setBusca("")
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={aberto}
            aria-invalid={ariaInvalid}
            size={size === "sm" ? "sm" : "default"}
            className={cn("justify-between font-normal", !rotuloAtual && "text-muted-foreground", className)}
          >
            <span className="truncate">{rotuloAtual || placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-56 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={busca}
            onValueChange={(v) => setBusca(v.slice(0, maxLength))}
            placeholder={buscaPlaceholder}
          />
          <CommandList>
            {filtradas.length === 0 && !podeAdicionar ? <CommandEmpty>Nenhum item encontrado.</CommandEmpty> : null}
            {filtradas.length > 0 ? (
              <CommandGroup>
                {filtradas.map((opcao) => (
                  <CommandItem
                    key={opcao.value}
                    value={opcao.value}
                    onSelect={() => selecionar(opcao.value)}
                  >
                    <Check className={cn("size-4", value === opcao.value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{opcao.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {podeAdicionar ? (
              <CommandGroup>
                <CommandItem value={`__adicionar__${termo}`} onSelect={() => selecionar(termo)}>
                  <Plus className="size-4" />
                  <span className="truncate">
                    Adicionar {'"'}
                    {termo}
                    {'"'}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </Popover>
  )
}
