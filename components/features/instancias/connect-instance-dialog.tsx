"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, RefreshCw } from "lucide-react"

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
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

// Gera um padrão determinístico só para simular visualmente um QR Code.
function useFakeQr(seed: string, refresh: number) {
  return useMemo(() => {
    const tamanho = 21
    const celulas: boolean[] = []
    let h = 0
    const base = `${seed}-${refresh}`
    for (let i = 0; i < base.length; i++) {
      h = (h * 31 + base.charCodeAt(i)) >>> 0
    }
    for (let i = 0; i < tamanho * tamanho; i++) {
      h = (h * 1103515245 + 12345) >>> 0
      celulas.push(((h >> 16) & 1) === 1)
    }
    return { tamanho, celulas }
  }, [seed, refresh])
}

function FakeQrCode({ seed, refresh }: { seed: string; refresh: number }) {
  const { tamanho, celulas } = useFakeQr(seed, refresh)

  const ehMarcador = (linha: number, coluna: number) => {
    const dentro = (l0: number, c0: number) =>
      linha >= l0 && linha < l0 + 7 && coluna >= c0 && coluna < c0 + 7
    return dentro(0, 0) || dentro(0, tamanho - 7) || dentro(tamanho - 7, 0)
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-border">
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `repeat(${tamanho}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {celulas.map((ativo, i) => {
          const linha = Math.floor(i / tamanho)
          const coluna = i % tamanho
          const marcador = ehMarcador(linha, coluna)
          const preenchido = marcador || ativo
          return (
            <span
              key={i}
              className={cn("aspect-square rounded-[1px]", preenchido ? "bg-neutral-900" : "bg-transparent")}
            />
          )
        })}
      </div>
    </div>
  )
}

export function ConnectInstanceDialog({
  instancia,
  onOpenChange,
  onConectar,
}: {
  instancia: Instance | null
  onOpenChange: (open: boolean) => void
  onConectar: (id: string) => void
}) {
  const [refresh, setRefresh] = useState(0)
  const [segundos, setSegundos] = useState(40)

  const aberto = Boolean(instancia)

  // Reinicia o contador sempre que o diálogo abre ou o QR é atualizado.
  useEffect(() => {
    if (!aberto) return
    setSegundos(40)
  }, [aberto, refresh])

  useEffect(() => {
    if (!aberto) return
    const timer = setInterval(() => {
      setSegundos((s) => (s <= 1 ? 40 : s - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [aberto])

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
          {instancia ? <FakeQrCode seed={instancia.id} refresh={refresh} /> : null}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Aguardando leitura • o código expira em {segundos}s
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
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setRefresh((r) => r + 1)}>
            <RefreshCw className="size-4" />
            Gerar novo código
          </Button>
          <Button type="button" onClick={() => instancia && onConectar(instancia.id)}>
            <CheckCircle2 className="size-4" />
            Simular conexão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
