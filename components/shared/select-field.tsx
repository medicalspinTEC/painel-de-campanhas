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
