"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react"

import { conectarInstanciaAction, statusInstanciaAction } from "@/app/actions/instancias"
import type { Instance } from "@/components/features/instancias/instancias-manager"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// Intervalo de polling do estado da conexão enquanto o QR está na tela.
const INTERVALO_POLLING_MS = 3000

export function ConnectInstanceDialog({
  instancia,
  onOpenChange,
  onConectar,
}: {
  instancia: Instance | null
  onOpenChange: (open: boolean) => void
  onConectar: (id: string) => void
}) {
  const [carregando, setCarregando] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [conectado, setConectado] = useState(false)

  const aberto = Boolean(instancia)
  const nome = instancia?.nome ?? ""
  const id = instancia?.id ?? ""

  // Guarda os callbacks/valores mais recentes para uso dentro dos timers sem
  // recriar os efeitos a cada render.
  const onConectarRef = useRef(onConectar)
  useEffect(() => {
    onConectarRef.current = onConectar
  }, [onConectar])

  const gerarQrCode = useCallback(async () => {
    if (!nome) return
    setCarregando(true)
    setErro(null)
    setQrCode(null)
    setPairingCode(null)

    const resultado = await conectarInstanciaAction(nome)

    if (!resultado.ok) {
      setErro(resultado.message ?? "Não foi possível gerar o QR Code.")
      setCarregando(false)
      return
    }

    // A instância já estava conectada: encerra o fluxo com sucesso.
    if (resultado.jaConectada) {
      setConectado(true)
      onConectarRef.current(id)
      setCarregando(false)
      return
    }

    setQrCode(resultado.qrCode ?? null)
    setPairingCode(resultado.pairingCode ?? null)
    setCarregando(false)
  }, [nome, id])

  // Ao abrir o diálogo, dispara a geração do QR e reseta o estado local.
  useEffect(() => {
    if (!aberto) {
      setQrCode(null)
      setPairingCode(null)
      setErro(null)
      setConectado(false)
      setCarregando(false)
      return
    }
    void gerarQrCode()
  }, [aberto, gerarQrCode])

  // Polling do estado da conexão enquanto o QR estiver visível.
  useEffect(() => {
    if (!aberto || conectado || erro) return

    let ativo = true
    const timer = setInterval(async () => {
      const status = await statusInstanciaAction(nome)
      if (!ativo) return
      if (status.ok && status.estado === "conectado") {
        setConectado(true)
        clearInterval(timer)
        onConectarRef.current(id)
      }
    }, INTERVALO_POLLING_MS)

    return () => {
      ativo = false
      clearInterval(timer)
    }
  }, [aberto, conectado, erro, nome, id])

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar {instancia?.nome}</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie o código abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {conectado ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-7" />
              </div>
              <p className="text-sm font-medium">Instância conectada!</p>
              <p className="text-xs text-muted-foreground">O WhatsApp foi pareado com sucesso.</p>
            </div>
          ) : erro ? (
            <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert className="size-5" />
              </div>
              <p className="text-sm font-medium text-destructive">Não foi possível gerar o código</p>
              <p className="text-xs text-muted-foreground break-words">{erro}</p>
            </div>
          ) : carregando || !qrCode ? (
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="size-[220px] rounded-xl" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                Gerando QR Code...
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-border">
                <Image
                  src={qrCode || "/placeholder.svg"}
                  alt={`QR Code para conectar a instância ${instancia?.nome}`}
                  width={220}
                  height={220}
                  unoptimized
                  className="size-[220px] object-contain"
                />
              </div>

              {pairingCode ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground">Ou use o código de pareamento:</span>
                  <span className="rounded-md bg-muted px-3 py-1 font-mono text-sm font-semibold tracking-widest">
                    {pairingCode}
                  </span>
                </div>
              ) : null}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                Aguardando leitura do código...
              </div>

              <ol className="w-full space-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">1.</span>
                  Abra o WhatsApp no seu celular.
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">2.</span>
                  Toque em Mais opções e depois em Aparelhos conectados.
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">3.</span>
                  Aponte a câmera para esta tela para capturar o código.
                </li>
              </ol>
            </>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {conectado ? (
            <Button type="button" className="w-full sm:w-auto sm:ml-auto" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => void gerarQrCode()} disabled={carregando}>
              <RefreshCw className="size-4" />
              Gerar novo código
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
