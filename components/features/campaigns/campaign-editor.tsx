"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useTransition } from "react"
import { CalendarClock, GripVertical, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { createCampaignAction, updateCampaignAction } from "@/app/actions/campaigns"
import { CreatableSelectField } from "@/components/shared/creatable-select-field"
import { LinkButton } from "@/components/shared/link-button"
import { SelectField, opcoesComExtras } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { formatNumber, renderTemplate } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  CAMPAIGN_STATUS_LABEL,
  type Campaign,
  type CampaignStatus,
} from "@/types"

const QUALQUER = "qualquer"

const OPCOES_STATUS = (Object.keys(CAMPAIGN_STATUS_LABEL) as CampaignStatus[]).map((s) => ({
  value: s,
  label: CAMPAIGN_STATUS_LABEL[s],
}))

interface MensagemRascunho {
  key: string
  id?: string
  dia: number
  horario: string
  texto: string
}

export interface LeadResumo {
  id: string
  nome: string
  telefone: string
  produto: string
  marca: string
  persona: string
  regiao: string
  // IDs das campanhas em que o lead está de fato vinculado (tabela N:N
  // LeadCampaign). É a fonte de verdade para marcar o checkbox como vinculado.
  campanhasIds: string[]
}

function novaMensagem(dia: number): MensagemRascunho {
  return { key: Math.random().toString(36).slice(2), dia, horario: "09:00", texto: "" }
}

export function CampaignEditor({
  campanha,
  leads,
  produtos = [],
  marcas = [],
  personas = [],
  regioes = [],
}: {
  campanha?: Campaign
  leads: LeadResumo[]
  /** Catálogos ativos cadastrados na página de Segmentação. */
  produtos?: string[]
  marcas?: string[]
  personas?: string[]
  regioes?: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [nome, setNome] = useState(campanha?.nome ?? "")
  const [descricao, setDescricao] = useState(campanha?.descricao ?? "")
  const [status, setStatus] = useState<string>(campanha?.status ?? "rascunho")
  const [recorrencia, setRecorrencia] = useState(String(campanha?.recorrenciaDias ?? 30))
  const [dataFinal, setDataFinal] = useState(campanha?.dataFinal ? campanha.dataFinal.slice(0, 10) : "")
  const [produto, setProduto] = useState(campanha?.filtros.produto ?? QUALQUER)
  const [marca, setMarca] = useState(campanha?.filtros.marca ?? QUALQUER)
  const [persona, setPersona] = useState(campanha?.filtros.persona ?? QUALQUER)
  const [regiao, setRegiao] = useState(campanha?.filtros.regiao ?? QUALQUER)
  const [mensagens, setMensagens] = useState<MensagemRascunho[]>(
    campanha?.mensagens.length
      ? campanha.mensagens.map((m) => ({ key: m.id, id: m.id, dia: m.dia, horario: m.horario, texto: m.texto }))
      : [novaMensagem(0)],
  )
  const [arrastando, setArrastando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)
  const [leadIdsSelecionados, setLeadIdsSelecionados] = useState<string[]>(() =>
    campanha ? leads.filter((l) => l.campanhasIds.includes(campanha.id)).map((l) => l.id) : [],
  )

  useEffect(() => {
    setLeadIdsSelecionados(campanha ? leads.filter((l) => l.campanhasIds.includes(campanha.id)).map((l) => l.id) : [])
  }, [campanha?.id, leads])

  const audiencia = useMemo(
    () =>
      leads.filter(
        (l) =>
          (produto === QUALQUER || l.produto === produto) &&
          (marca === QUALQUER || l.marca === marca) &&
          (persona === QUALQUER || l.persona === persona) &&
          (regiao === QUALQUER || l.regiao === regiao),
      ).length,
    [leads, produto, marca, persona, regiao],
  )

  // Opções derivam dos catálogos cadastrados na Segmentação + o que já existe
  // nos leads + o filtro salvo na campanha, para que itens legados sigam
  // disponíveis mesmo que não estejam mais no catálogo.
  const opcoesProduto = useMemo(
    () => [
      { value: QUALQUER, label: "Qualquer produto" },
      ...opcoesComExtras(produtos, ...leads.map((l) => l.produto), campanha?.filtros.produto),
    ],
    [produtos, leads, campanha],
  )
  const opcoesMarca = useMemo(
    () => [
      { value: QUALQUER, label: "Qualquer marca" },
      ...opcoesComExtras(marcas, ...leads.map((l) => l.marca), campanha?.filtros.marca),
    ],
    [marcas, leads, campanha],
  )
  const opcoesPersona = useMemo(
    () => [
      { value: QUALQUER, label: "Qualquer persona" },
      ...opcoesComExtras(personas, ...leads.map((l) => l.persona), campanha?.filtros.persona),
    ],
    [personas, leads, campanha],
  )
  const opcoesRegiao = useMemo(
    () => [
      { value: QUALQUER, label: "Qualquer região" },
      ...opcoesComExtras(regioes, ...leads.map((l) => l.regiao), campanha?.filtros.regiao),
    ],
    [regioes, leads, campanha],
  )

  function atualizarMensagem(index: number, patch: Partial<MensagemRascunho>) {
    setMensagens((atual) => atual.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  }

  function removerMensagem(index: number) {
    setMensagens((atual) => atual.filter((_, i) => i !== index))
  }

  function adicionarMensagem() {
    const ultimoDia = mensagens.at(-1)?.dia ?? -1
    setMensagens((atual) => [...atual, novaMensagem(ultimoDia + 2)])
  }

  function toggleLead(id: string, checked: boolean) {
    setLeadIdsSelecionados((atual) => (checked ? [...new Set([...atual, id])] : atual.filter((item) => item !== id)))
  }

  function reordenar(de: number, para: number) {
    if (de === para) return
    setMensagens((atual) => {
      const copia = [...atual]
      const [item] = copia.splice(de, 1)
      copia.splice(para, 0, item)
      return copia
    })
  }

  function salvar() {
    const input = {
      nome: nome.trim(),
      descricao: descricao.trim() || undefined,
      status: status as CampaignStatus,
      recorrenciaDias: Number(recorrencia) || 0,
      // Fixamos o fim do dia em UTC (`Z`) para que a data não "ande" a cada
      // salvamento: usar horário local converteria 23:59 para o dia seguinte em
      // UTC (fusos negativos), e ao reler o `slice(0, 10)` mostraria +1 dia.
      dataFinal: dataFinal ? `${dataFinal}T23:59:59.999Z` : null,
      filtros: {
        produto: produto === QUALQUER ? null : (produto as Campaign["filtros"]["produto"]),
        marca: marca === QUALQUER ? null : (marca as Campaign["filtros"]["marca"]),
        persona: persona === QUALQUER ? null : (persona as Campaign["filtros"]["persona"]),
        regiao: regiao === QUALQUER ? null : (regiao as Campaign["filtros"]["regiao"]),
      },
      leadIds: leadIdsSelecionados,
      mensagens: mensagens
        .slice()
        .sort((a, b) => a.dia - b.dia)
        .map((m) => ({ id: m.id, dia: Number(m.dia) || 0, horario: m.horario, texto: m.texto.trim() })),
    }

    startTransition(async () => {
      const res = campanha ? await updateCampaignAction(campanha.id, input) : await createCampaignAction(input)
      setErrors(res.errors ?? {})
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      router.push(res.id ? `/campanhas/${res.id}` : "/campanhas")
    })
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex flex-1 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Configuração da campanha</CardTitle>
            <CardDescription>Defina identidade, recorrência e data limite dos disparos.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field data-invalid={Boolean(errors.nome)}>
              <FieldLabel htmlFor="nome">Nome da campanha</FieldLabel>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Reativação Consórcio Imobiliário"
                aria-invalid={Boolean(errors.nome)}
              />
              {errors.nome ? <FieldError>{errors.nome}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="descricao">Descrição</FieldLabel>
              <Textarea
                id="descricao"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Objetivo da campanha e público-alvo"
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <SelectField
                  id="status"
                  value={status}
                  onValueChange={setStatus}
                  opcoes={OPCOES_STATUS}
                  className="w-full"
                />
              </Field>
              <Field data-invalid={Boolean(errors.recorrenciaDias)}>
                <FieldLabel htmlFor="recorrencia">Recorrência (dias)</FieldLabel>
                <Input
                  id="recorrencia"
                  type="number"
                  min={1}
                  value={recorrencia}
                  onChange={(e) => setRecorrencia(e.target.value)}
                  aria-invalid={Boolean(errors.recorrenciaDias)}
                />
                <FieldDescription>Intervalo para reiniciar a sequência.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="dataFinal">Data limite</FieldLabel>
                <Input
                  id="dataFinal"
                  type="date"
                  value={dataFinal}
                  onChange={(e) => setDataFinal(e.target.value)}
                />
                <FieldDescription>Opcional. Encerra os envios.</FieldDescription>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sequência de mensagens</CardTitle>
            <CardDescription>
              Arraste os cartões para reordenar. Use {"{{primeiro_nome}}"} para personalizar o texto.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {errors.mensagens ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.mensagens}
              </p>
            ) : null}

            {mensagens.map((mensagem, index) => (
              <div
                key={mensagem.key}
                draggable
                onDragStart={() => setArrastando(index)}
                onDragEnd={() => {
                  setArrastando(null)
                  setSobre(null)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setSobre(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (arrastando !== null) reordenar(arrastando, index)
                  setArrastando(null)
                  setSobre(null)
                }}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 transition-colors",
                  arrastando === index && "opacity-60",
                  sobre === index && arrastando !== index && "border-primary bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="cursor-grab text-muted-foreground" aria-hidden>
                    <GripVertical className="size-4" />
                  </span>
                  <span className="flex size-6 items-center justify-center rounded-md bg-primary/12 text-xs font-semibold text-primary tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex flex-1 items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Dia
                      <Input
                        type="number"
                        min={0}
                        value={mensagem.dia}
                        onChange={(e) => atualizarMensagem(index, { dia: Number(e.target.value) })}
                        className="h-8 w-16"
                        aria-label={`Dia da mensagem ${index + 1}`}
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Horário
                      <Input
                        type="time"
                        value={mensagem.horario}
                        onChange={(e) => atualizarMensagem(index, { horario: e.target.value })}
                        className="h-8 w-28"
                        aria-label={`Horário da mensagem ${index + 1}`}
                      />
                    </label>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removerMensagem(index)}
                    disabled={mensagens.length === 1}
                    aria-label={`Remover mensagem ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Textarea
                  value={mensagem.texto}
                  onChange={(e) => atualizarMensagem(index, { texto: e.target.value })}
                  placeholder="Olá {{primeiro_nome}}, tudo bem? Vi que você se interessou..."
                  rows={3}
                />
              </div>
            ))}

            <Button variant="outline" onClick={adicionarMensagem} className="w-full">
              <Plus className="size-4" />
              Adicionar mensagem
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex w-full flex-col gap-4 xl:w-80 xl:shrink-0">
        <Card>
          <CardHeader>
            <CardTitle>Vinculação manual</CardTitle>
            <CardDescription>Selecione leads específicos para entrar nesta campanha.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="max-h-64 space-y-2 overflow-auto pr-1">
              {leads.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cadastre leads para vincular manualmente.</p>
              ) : (
                leads.map((lead) => {
                  const checked = leadIdsSelecionados.includes(lead.id)
                  return (
                    <label
                      key={lead.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background/70 p-2.5"
                    >
                      <Checkbox checked={checked} onCheckedChange={(value) => toggleLead(lead.id, value === true)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{lead.nome}</span>
                          {checked ? <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Vinculado</span> : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{lead.telefone}</p>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Público-alvo</CardTitle>
            <CardDescription>Leads são incluídos automaticamente quando atendem aos filtros.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CreatableSelectField
              value={produto}
              onValueChange={setProduto}
              opcoes={opcoesProduto}
              buscaPlaceholder="Buscar ou adicionar produto..."
              className="w-full"
            />
            <CreatableSelectField
              value={marca}
              onValueChange={setMarca}
              opcoes={opcoesMarca}
              buscaPlaceholder="Buscar ou adicionar marca..."
              className="w-full"
            />
            <CreatableSelectField
              value={persona}
              onValueChange={setPersona}
              opcoes={opcoesPersona}
              buscaPlaceholder="Buscar ou adicionar persona..."
              className="w-full"
            />
            <CreatableSelectField
              value={regiao}
              onValueChange={setRegiao}
              opcoes={opcoesRegiao}
              buscaPlaceholder="Buscar ou adicionar região..."
              className="w-full"
            />

            <Separator />

            <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5">
              <Users className="size-4 text-primary" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold tabular-nums">{formatNumber(audiencia)} leads</span>
                <span className="text-xs text-muted-foreground">compatíveis com os filtros</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {mensagens.length} mensagens em {Math.max(...mensagens.map((m) => m.dia), 0)} dias
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pré-visualização</CardTitle>
            <CardDescription>Como o lead recebe no WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {mensagens.map((m, i) => (
              <div key={m.key} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Dia {m.dia} · {m.horario}
                </span>
                <p className="rounded-lg rounded-tl-sm bg-primary/12 px-3 py-2 text-sm leading-relaxed text-foreground">
                  {m.texto.trim() ? renderTemplate(m.texto) : `Mensagem ${i + 1} sem conteúdo`}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <LinkButton variant="outline" href={campanha ? `/campanhas/${campanha.id}` : "/campanhas"} className="flex-1">
            Cancelar
          </LinkButton>
          <Button onClick={salvar} disabled={pending} className="flex-1">
            {pending ? <Spinner /> : null}
            {campanha ? "Salvar" : "Criar campanha"}
          </Button>
        </div>
      </div>
    </div>
  )
}
