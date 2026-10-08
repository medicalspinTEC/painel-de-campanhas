"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Camera, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { removerMinhaFotoAction, salvarMinhaFotoAction } from "@/app/actions/users"
import { UserAvatar } from "@/components/shared/user-avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { FOTO_LADO } from "@/lib/foto-usuario"

const ORIGINAL_MAXIMO = 15 * 1024 * 1024 // 15 MB: foto de celular; é reduzida antes de subir

/**
 * Recorta o centro em quadrado e reduz para FOTO_LADO px (JPEG). Assim o upload fica leve
 * (dezenas de KB), a foto não carrega metadados (GPS/EXIF) e GIF/HEIC viram uma imagem comum.
 */
async function prepararFoto(arquivo: File): Promise<Blob> {
  const url = URL.createObjectURL(arquivo)
  try {
    const imagem = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Não foi possível ler esta imagem."))
      img.src = url
    })
    const lado = Math.min(imagem.naturalWidth, imagem.naturalHeight)
    if (!lado) throw new Error("Não foi possível ler esta imagem.")
    const canvas = document.createElement("canvas")
    canvas.width = FOTO_LADO
    canvas.height = FOTO_LADO
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.")
    ctx.fillStyle = "#ffffff" // PNG transparente vira fundo branco no JPEG
    ctx.fillRect(0, 0, FOTO_LADO, FOTO_LADO)
    ctx.imageSmoothingQuality = "high"
    const x = (imagem.naturalWidth - lado) / 2
    const y = (imagem.naturalHeight - lado) / 2
    ctx.drawImage(imagem, x, y, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
    if (!blob) throw new Error("Não foi possível preparar a imagem.")
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function FotoPerfilCard({ userId, nome, fotoEm }: { userId: string; nome: string; fotoEm: number | null }) {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const [pendente, startTransition] = useTransition()
  const [preparando, setPreparando] = useState(false)
  // Prévia imediata da foto enviada (até a página recarregar com a nova versão).
  const [previa, setPrevia] = useState<string | null>(null)

  async function aoEscolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0]
    evento.target.value = "" // permite escolher o mesmo arquivo de novo
    if (!arquivo) return
    if (!arquivo.type.startsWith("image/")) {
      toast.error("Escolha um arquivo de imagem.")
      return
    }
    if (arquivo.size > ORIGINAL_MAXIMO) {
      toast.error("A imagem é grande demais (máximo de 15 MB).")
      return
    }
    setPreparando(true)
    try {
      const blob = await prepararFoto(arquivo)
      const dados = new FormData()
      dados.set("foto", new File([blob], "foto.jpg", { type: "image/jpeg" }))
      startTransition(async () => {
        const r = await salvarMinhaFotoAction(dados)
        if (r.ok) {
          setPrevia(URL.createObjectURL(blob))
          toast.success(r.message)
          router.refresh()
        } else toast.error(r.message)
      })
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível usar esta imagem.")
    } finally {
      setPreparando(false)
    }
  }

  function remover() {
    startTransition(async () => {
      const r = await removerMinhaFotoAction()
      if (r.ok) {
        setPrevia(null)
        toast.success(r.message)
        router.refresh()
      } else toast.error(r.message)
    })
  }

  const ocupado = pendente || preparando

  return (
    <Card>
      <CardHeader>
        <CardTitle>Foto de perfil</CardTitle>
        <CardDescription>
          Sua foto aparece para a equipe no menu, no chat interno e nas listas de usuários e atendentes. Sem foto, são
          mostradas as suas iniciais.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {previa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previa} alt="" className="size-20 shrink-0 rounded-full object-cover" />
        ) : (
        <UserAvatar
          userId={userId}
          nome={nome}
          fotoEm={fotoEm}
          className="size-20 shrink-0 text-xl"
          fallbackClassName="text-xl font-semibold"
        />
        )}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input ref={entrada} type="file" accept="image/*" className="hidden" onChange={aoEscolher} />
            <Button onClick={() => entrada.current?.click()} disabled={ocupado}>
              {ocupado ? <Spinner /> : <Camera className="size-4" />}
              {fotoEm ? "Trocar foto" : "Escolher foto"}
            </Button>
            {fotoEm ? (
              <Button variant="outline" onClick={remover} disabled={ocupado}>
                <Trash2 className="size-4" />
                Remover
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            JPG, PNG ou WebP. A imagem é recortada em quadrado e reduzida automaticamente.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
