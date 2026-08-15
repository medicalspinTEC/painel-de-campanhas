"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface OpcaoSelect {
  value: string
  label: string
}

/** Select controlado que também envia o valor em formulários via `name`. */
export function SelectField({
  name,
  value,
  onValueChange,
  opcoes,
  placeholder = "Selecione",
  size = "default",
  className,
  id,
  ariaInvalid,
}: {
  name?: string
  value: string
  onValueChange: (value: string) => void
  opcoes: OpcaoSelect[]
  placeholder?: string
  size?: "sm" | "default"
  className?: string
  id?: string
  ariaInvalid?: boolean
}) {
  return (
    <Select
      name={name}
      value={value}
      onValueChange={(next) => onValueChange(String(next ?? ""))}
      items={opcoes}
    >
      <SelectTrigger id={id} size={size} className={className} aria-invalid={ariaInvalid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map((opcao) => (
          <SelectItem key={opcao.value} value={opcao.value}>
            {opcao.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function opcoesDe(valores: readonly string[]): OpcaoSelect[] {
  return valores.map((v) => ({ value: v, label: v }))
}

/**
 * Mescla os valores padrão com valores já cadastrados (ex.: itens adicionados
 * manualmente e salvos em leads/campanhas), removendo vazios e duplicados e
 * preservando a ordem: padrões primeiro, extras em seguida.
 */
export function opcoesComExtras(padroes: readonly string[], ...extras: Array<string | null | undefined>): OpcaoSelect[] {
  const vistos = new Set<string>()
  const resultado: OpcaoSelect[] = []
  for (const valor of [...padroes, ...extras]) {
    const limpo = (valor ?? "").trim()
    if (!limpo || vistos.has(limpo)) continue
    vistos.add(limpo)
    resultado.push({ value: limpo, label: limpo })
  }
  return resultado
}
