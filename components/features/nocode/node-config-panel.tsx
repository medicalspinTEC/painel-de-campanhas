"use client"

import { Copy, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ICONES } from "@/components/features/nocode/node-visuals"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { gerarToken, NODE_CATALOG, type FlowNode, type NodeConfig } from "@/lib/nocode/catalog"
import { cn } from "@/lib/utils"

async function copiar(texto: string, mensagem: string) {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success(mensagem)
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.")
  }
}

export function NodeConfigPanel({
  no,
  flowId,
  variaveis,
  atendentes = [],
  onNome,
  onConfig,
  onExcluir,
}: {
  no: FlowNode
  flowId: string
  variaveis: string[]
  /** Atendentes ativos do CRM, para o campo "atendente". */
  atendentes?: { id: string; nome: string }[]
  onNome: (nome: string) => void
  onConfig: (patch: NodeConfig) => void
  onExcluir: () => void
}) {
  const def = NODE_CATALOG[no.type]
  const Icone = ICONES[def.icone]
  const token = String(no.config.token ?? "")
  const urlWebhook =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/nocode/webhook/${flowId}?token=${token}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", def.cor)}>
          <Icone className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{def.label}</p>
          <p className="text-xs leading-snug text-muted-foreground">{def.descricao}</p>
        </div>
      </div>

      <Field>
        <FieldLabel htmlFor="no-nome">Nome do bloco</FieldLabel>
        <Input id="no-nome" value={no.name} maxLength={60} onChange={(event) => onNome(event.target.value)} />
      </Field>

      {def.campos
        .filter((campo) => !campo.mostrarSe || String(no.config[campo.mostrarSe.key] ?? "") === campo.mostrarSe.value)
        .map((campo) => {
        const id = `no-${campo.key}`
        const valor = no.config[campo.key]
        return (
          <Field key={campo.key}>
            {campo.kind === "switch" ? (
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor={id}>{campo.label}</FieldLabel>
                <Switch id={id} checked={valor === true} onCheckedChange={(v) => onConfig({ [campo.key]: v })} />
              </div>
            ) : (
              <FieldLabel htmlFor={id}>{campo.label}</FieldLabel>
            )}
            {campo.kind === "text" ? (
              <Input
                id={id}
                value={String(valor ?? "")}
                placeholder={campo.placeholder}
                onChange={(event) => onConfig({ [campo.key]: event.target.value })}
              />
            ) : null}
            {campo.kind === "textarea" ? (
              <Textarea
                id={id}
                rows={4}
                value={String(valor ?? "")}
                placeholder={campo.placeholder}
                onChange={(event) => onConfig({ [campo.key]: event.target.value })}
              />
            ) : null}
            {campo.kind === "number" ? (
              <Input
                id={id}
                type="number"
                min={0}
                max={30}
                value={String(valor ?? "")}
                placeholder={campo.placeholder}
                onChange={(event) => onConfig({ [campo.key]: Number(event.target.value) })}
              />
            ) : null}
            {campo.kind === "select" ? (
              <SelectField
                id={id}
                value={String(valor ?? "")}
                onValueChange={(v) => onConfig({ [campo.key]: v })}
                opcoes={campo.options ?? []}
              />
            ) : null}
            {campo.kind === "atendente" ? (
              <SelectField
                id={id}
                value={String(valor ?? "")}
                onValueChange={(v) => onConfig({ [campo.key]: v })}
                opcoes={atendentes.map((a) => ({ value: a.id, label: a.nome }))}
              />
            ) : null}
            {campo.kind === "atendente" && atendentes.length === 0 ? (
              <FieldDescription>Nenhum atendente ativo. Cadastre em CRM → Atendentes.</FieldDescription>
            ) : null}
            {campo.help ? <FieldDescription>{campo.help}</FieldDescription> : null}
          </Field>
        )
      })}

      {no.type === "webhook" ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-xs font-medium">URL do webhook</p>
          <p className="break-all rounded-md bg-background px-2 py-1.5 font-mono text-[11px] leading-snug">{urlWebhook}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copiar(urlWebhook, "URL copiada.")}>
              <Copy className="size-3.5" />
              Copiar URL
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onConfig({ token: gerarToken() })
                toast.message("Novo token gerado. Salve o fluxo e atualize a URL na Evolution.")
              }}
            >
              <RefreshCw className="size-3.5" />
              Novo token
            </Button>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">
            Na Evolution, abra a instância → Webhook, ative-o, cole esta URL e marque o evento{" "}
            <code>MESSAGES_UPSERT</code>. O app precisa estar acessível pela internet.
          </p>
        </div>
      ) : null}

      {def.campos.length > 0 && variaveis.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">Variáveis disponíveis (clique para copiar)</p>
          <div className="flex flex-wrap gap-1.5">
            {variaveis.map((variavel) => (
              <button
                key={variavel}
                type="button"
                onClick={() => void copiar(`{{${variavel}}}`, "Variável copiada.")}
                className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {variavel}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Button variant="destructive" size="sm" className="w-fit" onClick={onExcluir}>
        <Trash2 className="size-4" />
        Remover bloco
      </Button>
    </div>
  )
}
