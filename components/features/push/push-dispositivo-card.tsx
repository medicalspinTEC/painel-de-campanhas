"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { ativarPush, desativarPush, lerEstadoPush, pushDisponivelNoAmbiente, type EstadoPush } from "@/lib/push-cliente"

const TEXTO: Record<EstadoPush | "carregando", { selo: string; descricao: string }> = {
  carregando: { selo: "Verificando…", descricao: "Conferindo as notificações deste aparelho." },
  ativo: { selo: "Ativadas", descricao: "Este aparelho recebe avisos do painel mesmo com o app fechado." },
  inativo: { selo: "Desativadas", descricao: "A permissão existe, mas este aparelho não está registrado. Ative para voltar a receber avisos." },
  pedir: { selo: "Desativadas", descricao: "Ative para receber avisos do painel mesmo com o app fechado." },
  bloqueado: {
    selo: "Bloqueadas",
    descricao: "O navegador/aparelho bloqueou as notificações deste app. Libere nas configurações do navegador (ou do sistema) e volte aqui.",
  },
  "ios-instalar": {
    selo: "Instale o app",
    descricao: "No iPhone/iPad, as notificações só funcionam com o app instalado: Compartilhar → “Adicionar à Tela de Início”, e abra pelo ícone.",
  },
  "nao-suportado": { selo: "Indisponíveis", descricao: "Este navegador não permite notificações push." },
  "sem-servidor": { selo: "Indisponíveis", descricao: "As notificações ainda não foram configuradas no servidor. Fale com o administrador." },
}

/** Preferência pessoal (Minha conta): liga/desliga as notificações push NESTE aparelho. */
export function PushDispositivoCard() {
  const [estado, setEstado] = useState<EstadoPush | "carregando">("carregando")
  const [ocupado, setOcupado] = useState(false)
  const producao = pushDisponivelNoAmbiente()

  const atualizar = useCallback(async () => {
    const { estado: atual } = await lerEstadoPush().catch(() => ({ estado: "nao-suportado" as EstadoPush }))
    setEstado(atual)
  }, [])

  useEffect(() => {
    if (producao) void atualizar()
  }, [producao, atualizar])

  async function ativar() {
    setOcupado(true)
    try {
      const resultado = await ativarPush()
      if (resultado.ok) toast.success("Notificações ativadas neste aparelho.")
      else toast.error(resultado.message)
      await atualizar()
    } finally {
      setOcupado(false)
    }
  }

  async function desativar() {
    setOcupado(true)
    try {
      const resultado = await desativarPush()
      if (resultado.ok) toast.success("Notificações desativadas neste aparelho.")
      else toast.error(resultado.message)
      await atualizar()
    } finally {
      setOcupado(false)
    }
  }

  const texto = producao ? TEXTO[estado] : { selo: "Só em produção", descricao: "As notificações push só funcionam no app publicado (o service worker não roda em desenvolvimento)." }
  const podeAtivar = producao && (estado === "pedir" || estado === "inativo")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4" />
          Notificações neste aparelho
          <Badge variant={estado === "ativo" ? "default" : "outline"}>{texto.selo}</Badge>
        </CardTitle>
        <CardDescription>{texto.descricao}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {podeAtivar ? (
          <Button onClick={() => void ativar()} disabled={ocupado}>
            {ocupado ? <Spinner /> : <Bell className="size-4" />}
            Ativar notificações
          </Button>
        ) : null}
        {producao && estado === "ativo" ? (
          <Button variant="outline" onClick={() => void desativar()} disabled={ocupado}>
            {ocupado ? <Spinner /> : <BellOff className="size-4" />}
            Desativar neste aparelho
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
