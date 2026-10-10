"use client"

import { useEffect, useState } from "react"
import { Bell, Share, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ativarPush,
  assinarEsteAparelho,
  lerEstadoPush,
  pushDisponivelNoAmbiente,
  type EstadoPush,
} from "@/lib/push-cliente"

const CHAVE_DISPENSADO = "push-aviso-dispensado-ate"
const DIAS_DISPENSA = 7

function dispensado(): boolean {
  try {
    return Number(localStorage.getItem(CHAVE_DISPENSADO) ?? 0) > Date.now()
  } catch {
    return false
  }
}

function dispensar() {
  try {
    localStorage.setItem(CHAVE_DISPENSADO, String(Date.now() + DIAS_DISPENSA * 86_400_000))
  } catch {
    // sem localStorage: o aviso volta na próxima visita
  }
}

/**
 * Faz o app SOLICITAR as notificações. Os navegadores só aceitam o pedido de permissão depois de um
 * toque do usuário, então o app mostra um aviso com o botão "Ativar notificações" (e, no iPhone fora
 * do app instalado, ensina a instalar na tela inicial). Se a permissão já foi concedida, só renova
 * em silêncio o registro do aparelho (inclusive quando outro usuário entra neste mesmo aparelho).
 */
export function PushAtivador() {
  const [estado, setEstado] = useState<EstadoPush | "oculto">("oculto")
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!pushDisponivelNoAmbiente()) return
    let cancelado = false

    ;(async () => {
      const { estado: atual } = await lerEstadoPush().catch(() => ({ estado: "nao-suportado" as EstadoPush }))
      if (cancelado) return

      // Permissão já concedida: mantém o registro do aparelho em dia, sem incomodar.
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && (atual === "ativo" || atual === "inativo")) {
        await assinarEsteAparelho().catch(() => undefined)
        return
      }
      if ((atual === "pedir" || atual === "ios-instalar") && !dispensado()) setEstado(atual)
    })()

    return () => {
      cancelado = true
    }
  }, [])

  if (estado !== "pedir" && estado !== "ios-instalar") return null

  async function ativar() {
    setOcupado(true)
    try {
      const resultado = await ativarPush()
      if (resultado.ok) {
        toast.success("Notificações ativadas neste aparelho.")
        setEstado("oculto")
      } else {
        toast.error(resultado.message)
        // Negado: não insiste (o navegador também não deixa perguntar de novo).
        if (typeof Notification !== "undefined" && Notification.permission === "denied") setEstado("oculto")
      }
    } finally {
      setOcupado(false)
    }
  }

  function agoraNao() {
    dispensar()
    setEstado("oculto")
  }

  return (
    <div
      role="dialog"
      aria-label="Ativar notificações"
      className="fixed inset-x-3 z-50 flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-lg sm:left-auto sm:right-4 sm:w-96"
      style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {estado === "ios-instalar" ? <Share className="size-4" /> : <Bell className="size-4" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium">
            {estado === "ios-instalar" ? "Instale o app para receber avisos" : "Receba avisos mesmo com o app fechado"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {estado === "ios-instalar"
              ? "No iPhone, as notificações só funcionam com o app instalado: toque em Compartilhar e depois em “Adicionar à Tela de Início”. Abra o app pelo ícone e ative as notificações."
              : "Ative as notificações para ser avisado de novidades e comunicados importantes, sem precisar estar com o painel aberto."}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={agoraNao} aria-label="Fechar aviso">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={agoraNao}>
          Agora não
        </Button>
        {estado === "pedir" ? (
          <Button size="sm" onClick={() => void ativar()} disabled={ocupado}>
            <Bell className="size-4" />
            Ativar notificações
          </Button>
        ) : null}
      </div>
    </div>
  )
}
