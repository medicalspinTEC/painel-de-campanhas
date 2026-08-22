"use client"

import { useState, useTransition } from "react"
import { Info } from "lucide-react"
import { toast } from "sonner"

import { saveSettingsAction } from "@/app/actions/settings"
import type { Settings } from "@/services/settings"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

const FUSOS = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
]

export function SettingsForm({ inicial }: { inicial: Settings }) {
  const [pending, startTransition] = useTransition()
  const [remetente, setRemetente] = useState(inicial.remetente)
  const [numero, setNumero] = useState(inicial.numero)
  const [fuso, setFuso] = useState(inicial.fuso)
  const [inicio, setInicio] = useState(inicial.janelaInicio)
  const [fim, setFim] = useState(inicial.janelaFim)
  const [limite, setLimite] = useState(String(inicial.limiteDiario))
  const [assinatura, setAssinatura] = useState(inicial.assinatura)
  const [respeitarJanela, setRespeitarJanela] = useState(inicial.respeitarJanela)
  const [pausarNoFimDeSemana, setPausarNoFimDeSemana] = useState(inicial.pausarNoFimDeSemana)
  const [notificarFalhas, setNotificarFalhas] = useState(inicial.notificarFalhas)

  function salvar() {
    startTransition(async () => {
      const resultado = await saveSettingsAction({
        remetente,
        numero,
        assinatura,
        fuso,
        janelaInicio: inicio,
        janelaFim: fim,
        // O input numérico devolve string; `NaN` é barrado na validação da action.
        limiteDiario: Number.parseInt(limite, 10),
        respeitarJanela,
        pausarNoFimDeSemana,
        notificarFalhas,
      })
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        <Card>
          <CardHeader>
            <CardTitle>Identidade do remetente</CardTitle>
            <CardDescription>Usada nos disparos quando o WhatsApp for integrado.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
          
            Não afirmamos que existe sessão ativa: nenhuma API de WhatsApp está
            conectada ainda, então o aviso é informativo e não um status falso.
          
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              O envio pelo WhatsApp ainda não está integrado. Estas preferências ficam salvas no banco e serão aplicadas
              quando a API for conectada.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="remetente">Nome do remetente</FieldLabel>
              <Input id="remetente" value={remetente} onChange={(e) => setRemetente(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="numero">Número do remetente</FieldLabel>
              <Input id="numero" value={numero} onChange={(e) => setNumero(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="assinatura">Assinatura padrão</FieldLabel>
            <Textarea id="assinatura" rows={2} value={assinatura} onChange={(e) => setAssinatura(e.target.value)} />
            <FieldDescription>Anexada ao final de cada mensagem enviada.</FieldDescription>
          </Field>
        </CardContent>
      </Card>*/}

      <Card>
        {/*<CardHeader>
          <CardTitle>Janela de envio</CardTitle>
          <CardDescription>Controle quando a engine pode disparar mensagens.</CardDescription>
        </CardHeader>*/}
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="fuso">Fuso horário</FieldLabel>
            <SelectField id="fuso" value={fuso} onValueChange={setFuso} opcoes={FUSOS} className="w-full sm:w-72" />
          </Field>
          {/*<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="inicio">Início</FieldLabel>
              <Input id="inicio" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="fim">Fim</FieldLabel>
              <Input id="fim" type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="limite">Limite diário</FieldLabel>
              <Input id="limite" type="number" min={1} value={limite} onChange={(e) => setLimite(e.target.value)} />
              <FieldDescription>Mensagens por dia.</FieldDescription>
            </Field>
          </div>*/}

          <Separator />

          {/*<Opcao
            id="respeitar-janela"
            titulo="Respeitar janela de horário"
            descricao="Mensagens agendadas fora da janela são reprogramadas para o próximo horário válido."
            checked={respeitarJanela}
            onCheckedChange={setRespeitarJanela}
          />&*/}
          <Opcao
            id="pausar-fds"
            titulo="Pausar em fins de semana"
            descricao="Sábados e domingos ficam sem disparos automáticos."
            checked={pausarNoFimDeSemana}
            onCheckedChange={setPausarNoFimDeSemana}
          />
          <Opcao
            id="notificar-falhas"
            titulo="Notificar falhas de entrega"
            descricao="Envia um resumo diário das falhas registradas nos logs."
            checked={notificarFalhas}
            onCheckedChange={setNotificarFalhas}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={pending}>
          {pending ? <Spinner /> : null}
          Salvar preferências
        </Button>
      </div>
    </div>
  )
}

function Opcao({
  id,
  titulo,
  descricao,
  checked,
  onCheckedChange,
}: {
  id: string
  titulo: string
  descricao: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {titulo}
        </label>
        <span className="text-sm text-muted-foreground">{descricao}</span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
