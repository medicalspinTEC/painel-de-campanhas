"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { createAgenteIaAction, listarModelosIaAction, updateAgenteIaAction } from "@/app/actions/agentes-ia"
import { SelectField, type OpcaoSelect } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { infoDoProvedor, LIMITE_NOME_AGENTE, LIMITE_PROMPT_AGENTE, PROMPT_EXEMPLO, PROVEDORES, type ProvedorIa } from "@/lib/agentes-ia"
import type { AgenteIaItem } from "@/services/agentes-ia"

export function AgenteFormDialog({
  open,
  onOpenChange,
  agente,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agente?: AgenteIaItem | null
}) {
  const editando = Boolean(agente)
  const [pending, startTransition] = useTransition()
  const [carregando, startCarregar] = useTransition()
  const [nome, setNome] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [provedor, setProvedor] = useState<ProvedorIa>("claude")
  const [baseUrl, setBaseUrl] = useState("")
  const [modelo, setModelo] = useState(infoDoProvedor("claude").modeloPadrao)
  const [prompt, setPrompt] = useState("")
  const [modelosDaConta, setModelosDaConta] = useState<OpcaoSelect[] | null>(null)

  // O diálogo é reaproveitado para criar e editar: recarrega os campos a cada abertura.
  useEffect(() => {
    if (!open) return
    setNome(agente?.nome ?? "")
    setApiKey("")
    setProvedor(agente?.provedor ?? "claude")
    setBaseUrl(agente?.baseUrl ?? "")
    setModelo(agente?.modelo ?? infoDoProvedor("claude").modeloPadrao)
    setPrompt(agente?.prompt ?? "")
    setModelosDaConta(null)
  }, [open, agente])

  const info = infoDoProvedor(provedor)
  const generico = provedor === "compativel"
  // Provedor genérico sem lista carregada: o modelo é digitado.
  const modeloDigitado = generico && !modelosDaConta

  const opcoesModelo = useMemo<OpcaoSelect[]>(() => {
    const base = modelosDaConta ?? info.modelos.map((m) => ({ value: m.id, label: m.label }))
    // Mantém o modelo já salvo visível mesmo que não esteja na lista.
    return !modelo || base.some((o) => o.value === modelo) ? base : [{ value: modelo, label: modelo }, ...base]
  }, [modelosDaConta, modelo, info])

  function trocarProvedor(valor: string) {
    const novo = valor as ProvedorIa
    setProvedor(novo)
    setModelo(infoDoProvedor(novo).modeloPadrao)
    setModelosDaConta(null)
  }

  function carregarModelos() {
    startCarregar(async () => {
      const resultado = await listarModelosIaAction({ provedor, baseUrl, apiKey, agenteId: agente?.id ?? null })
      if (!resultado.ok || !resultado.modelos) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      setModelosDaConta(resultado.modelos.map((m) => ({ value: m.id, label: m.nome === m.id ? m.id : `${m.nome} (${m.id})` })))
    })
  }

  function salvar() {
    startTransition(async () => {
      const payload = { nome, provedor, baseUrl, modelo, prompt, apiKey }
      const resultado = agente ? await updateAgenteIaAction(agente.id, payload) : await createAgenteIaAction(payload)
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  const semChaveParaCarregar = !apiKey.trim() && !(agente?.temChave && agente.provedor === provedor)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar agente de IA" : "Novo agente de IA"}</DialogTitle>
          <DialogDescription>
            O agente responde as mensagens dos leads usando um modelo de IA (Claude, Groq ou outra API compatível). Por enquanto ele só conversa: não executa comandos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="agente-nome">Nome</FieldLabel>
            <Input
              id="agente-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={LIMITE_NOME_AGENTE}
              placeholder="Atendimento comercial"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="agente-provedor">Provedor de IA</FieldLabel>
            <SelectField
              id="agente-provedor"
              value={provedor}
              onValueChange={trocarProvedor}
              opcoes={PROVEDORES.map((p) => ({ value: p.key, label: p.label }))}
            />
            {provedor !== "claude" ? (
              <FieldDescription>Pensado para testes: confira custo, limites e privacidade do provedor antes de usar com clientes reais.</FieldDescription>
            ) : null}
          </Field>

          {generico ? (
            <Field>
              <FieldLabel htmlFor="agente-base-url">Endereço da API (base URL)</FieldLabel>
              <Input
                id="agente-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                inputMode="url"
              />
              <FieldDescription>Precisa ser https e expor /chat/completions e /models no padrão da OpenAI.</FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="agente-chave">Chave de API</FieldLabel>
            <Input
              id="agente-chave"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editando && agente?.temChave && agente.provedor === provedor ? `Chave salva (${agente.chaveFinal}) — deixe em branco para manter` : info.chavePlaceholder}
            />
            <FieldDescription>
              {info.chaveAjuda} Ela é guardada criptografada e nunca é exibida de novo nem entra no backup.
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="agente-modelo">Modelo</FieldLabel>
              <Button type="button" variant="ghost" size="sm" onClick={carregarModelos} disabled={carregando || semChaveParaCarregar}>
                {carregando ? <Spinner /> : <RefreshCw className="size-3.5" />}
                Carregar modelos da conta
              </Button>
            </div>
            {modeloDigitado ? (
              <Input id="agente-modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="gpt-4o-mini" />
            ) : (
              <SelectField id="agente-modelo" value={modelo} onValueChange={setModelo} opcoes={opcoesModelo} />
            )}
            <FieldDescription>
              {info.modelos.find((m) => m.id === modelo)?.dica ?? "“Carregar modelos da conta” lista os modelos disponíveis e também testa a chave."}
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="agente-prompt">Prompt do agente de atendimento</FieldLabel>
              {!prompt.trim() ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPrompt(PROMPT_EXEMPLO)}>
                  Usar exemplo
                </Button>
              ) : null}
            </div>
            <Textarea
              id="agente-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={LIMITE_PROMPT_AGENTE}
              rows={10}
              placeholder="Quem é o agente, como deve falar, o que pode responder e quando passar para um humano."
            />
            <FieldDescription>
              {prompt.length}/{LIMITE_PROMPT_AGENTE}. O app já avisa o agente do canal (WhatsApp), do nome do cliente, do departamento e da data;
              escreva aqui o que é específico do seu negócio.
            </FieldDescription>
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Criar agente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
