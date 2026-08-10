"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Clock, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { setLeadCampaignEntryAction } from "@/app/actions/leads"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatDateTime } from "@/lib/format"
import { calcularProximaMensagem, formatarTempoAte, type MensagemAgendada } from "@/lib/next-message"

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

// Presets de ajuste. Adiantar (negativo) move a entrada para o passado, o que
// aproxima o próximo envio; retardar (positivo) empurra tudo para frente.
const ATALHOS: Array<{ rotulo: string; ms: number }> = [
  { rotulo: "-1 dia", ms: -DIA },
  { rotulo: "-1 h", ms: -HORA },
  { rotulo: "-10 min", ms: -10 * MINUTO },
  { rotulo: "+10 min", ms: 10 * MINUTO },
  { rotulo: "+1 h", ms: HORA },
  { rotulo: "+1 dia", ms: DIA },
]

/** Converte uma Date para o formato aceito pelo input datetime-local (hora local). */
function paraInputLocal(data: Date): string {
  const ajustada = new Date(data.getTime() - data.getTimezoneOffset() * MINUTO)
  return ajustada.toISOString().slice(0, 16)
}

interface ProximaMensagemCellProps {
  leadId: string
  leadNome: string
  campanhaId: string
  entradaCampanhaEm: string | null
  recorrenciaDias: number
  mensagens: MensagemAgendada[]
}

export function ProximaMensagemCell({
  leadId,
  leadNome,
  campanhaId,
  entradaCampanhaEm,
  recorrenciaDias,
  mensagens,
}: ProximaMensagemCellProps) {
  const [aberto, setAberto] = useState(false)
  const [pending, startTransition] = useTransition()
  // Relógio compartilhado que atualiza o countdown exibido a cada 30s.
  const [agora, setAgora] = useState(() => Date.now())
  // Rascunho da entrada enquanto o popover está aberto (ainda não salvo).
  const [rascunho, setRascunho] = useState<string | null>(entradaCampanhaEm)

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Sincroniza o rascunho quando o valor salvo muda (ex.: após revalidação).
  useEffect(() => {
    setRascunho(entradaCampanhaEm)
  }, [entradaCampanhaEm])

  const campanha = useMemo(() => ({ recorrenciaDias, mensagens }), [recorrenciaDias, mensagens])

  const agoraDate = new Date(agora)
  const proximaSalva = calcularProximaMensagem(entradaCampanhaEm, campanha, agoraDate)
  const proximaRascunho = calcularProximaMensagem(rascunho, campanha, agoraDate)

  const houveMudanca = (rascunho ?? null) !== (entradaCampanhaEm ?? null)

  function ajustar(ms: number) {
    setRascunho((atual) => {
      const base = atual ? new Date(atual) : new Date()
      return new Date(base.getTime() + ms).toISOString()
    })
  }

  function definirManual(valor: string) {
    if (!valor) {
      setRascunho(null)
      return
    }
    const data = new Date(valor)
    if (!Number.isNaN(data.getTime())) setRascunho(data.toISOString())
  }

  function aplicar() {
    startTransition(async () => {
      const res = await setLeadCampaignEntryAction(leadId, rascunho, campanhaId)
      if (res.ok) {
        toast.success(`Tempo de espera de ${leadNome} atualizado.`)
        setAberto(false)
      } else {
        toast.error(res.message)
      }
    })
  }

  function resetar() {
    setRascunho(entradaCampanhaEm)
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="tabular-nums text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            {formatarTempoAte(proximaSalva, agoraDate)}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Ajustar tempo de espera</PopoverTitle>
          <PopoverDescription>
            Adiante ou atrase a entrada de {leadNome} na campanha para testar o disparo sem esperar o
            ciclo completo.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flex flex-col gap-1 rounded-md bg-muted/60 p-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Próxima mensagem</span>
            <span className="font-medium tabular-nums">{formatarTempoAte(proximaRascunho, agoraDate)}</span>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {proximaRascunho ? formatDateTime(proximaRascunho) : "Sem envio previsto"}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Ajuste rápido</span>
          <div className="grid grid-cols-3 gap-1.5">
            {ATALHOS.map((atalho) => (
              <Button
                key={atalho.rotulo}
                type="button"
                variant="outline"
                size="sm"
                className="tabular-nums"
                onClick={() => ajustar(atalho.ms)}
                disabled={pending}
              >
                {atalho.rotulo}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`entrada-${leadId}`} className="text-xs font-medium text-muted-foreground">
            Entrada na campanha
          </Label>
          <Input
            id={`entrada-${leadId}`}
            type="datetime-local"
            value={rascunho ? paraInputLocal(new Date(rascunho)) : ""}
            onChange={(e) => definirManual(e.target.value)}
            disabled={pending}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetar}
            disabled={pending || !houveMudanca}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Desfazer
          </Button>
          <Button type="button" size="sm" onClick={aplicar} disabled={pending || !houveMudanca}>
            {pending ? "Salvando..." : "Aplicar"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
