"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ImagePlus, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { saveAppMarcaAction } from "@/app/actions/settings"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

const LOGO_PADRAO = "/icon-light-32x32.png"
const TAMANHO_LOGO = 128
const LIMITE_NOME = 40
const TIPOS_ACEITOS = ["image/png", "image/jpeg", "image/webp"]
const LIMITE_ARQUIVO = 8 * 1024 * 1024
const LIMITE_DATA_URL = 150_000

/** Recorta a imagem em quadrado e reduz para 128×128 (mantém transparência em PNG). */
async function reduzirImagem(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo)
  try {
    const lado = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = TAMANHO_LOGO
    canvas.height = TAMANHO_LOGO
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas indisponível.")
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(
      bitmap,
      (bitmap.width - lado) / 2,
      (bitmap.height - lado) / 2,
      lado,
      lado,
      0,
      0,
      TAMANHO_LOGO,
      TAMANHO_LOGO,
    )
    let url = canvas.toDataURL("image/png")
    if (url.length > LIMITE_DATA_URL) url = canvas.toDataURL("image/webp", 0.85)
    if (url.length > LIMITE_DATA_URL) throw new Error("Imagem muito pesada.")
    return url
  } finally {
    bitmap.close()
  }
}

/**
 * Troca o nome e a logo exibidos no topo da sidebar. O subtítulo
 * ("Follow-up WhatsApp v…") é fixo e não faz parte desta opção.
 */
export function MarcaForm({ inicial }: { inicial: { nome: string; logo: string | null } }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [nome, setNome] = useState(inicial.nome)
  const [logo, setLogo] = useState<string | null>(inicial.logo)
  const [salvo, setSalvo] = useState(inicial)
  const inputArquivo = useRef<HTMLInputElement>(null)

  const alterado = nome.trim() !== salvo.nome || logo !== salvo.logo

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return
    if (!TIPOS_ACEITOS.includes(arquivo.type)) {
      toast.error("Use uma imagem PNG, JPG ou WebP.")
      return
    }
    if (arquivo.size > LIMITE_ARQUIVO) {
      toast.error("A imagem é muito grande (máximo de 8 MB).")
      return
    }
    try {
      setLogo(await reduzirImagem(arquivo))
    } catch {
      toast.error("Não foi possível processar essa imagem. Tente outra.")
    } finally {
      if (inputArquivo.current) inputArquivo.current.value = ""
    }
  }

  function salvar() {
    startTransition(async () => {
      const resultado = await saveAppMarcaAction({ nome, logo })
      if (resultado.ok) {
        setSalvo({ nome: nome.trim(), logo })
        toast.success(resultado.message)
        router.refresh()
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identidade do painel</CardTitle>
        <CardDescription>Troque a logo e o nome exibidos no topo da barra lateral.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex shrink-0 flex-col items-start gap-2">
            <span className="text-sm font-medium">Logo</span>
            <div className="flex items-center gap-3">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo ?? LOGO_PADRAO} alt="Pré-visualização da logo" className="size-14 rounded-lg object-cover" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => inputArquivo.current?.click()} disabled={pending}>
                  <ImagePlus className="size-4" />
                  Trocar foto
                </Button>
                {logo ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLogo(null)} disabled={pending}>
                    <RotateCcw className="size-4" />
                    Usar a padrão
                  </Button>
                ) : null}
              </div>
            </div>
            <input
              ref={inputArquivo}
              type="file"
              accept={TIPOS_ACEITOS.join(",")}
              className="sr-only"
              aria-label="Escolher imagem da logo"
              onChange={(event) => void escolherArquivo(event.target.files?.[0])}
            />
          </div>

          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="app-nome">Nome</FieldLabel>
            <Input
              id="app-nome"
              value={nome}
              maxLength={LIMITE_NOME}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Medical Spin"
            />
            <FieldDescription>
              Aparece em destaque na barra lateral. O subtítulo com a versão não muda.
            </FieldDescription>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Pré-visualização</span>
          <div className="flex w-fit max-w-full items-center gap-2.5 rounded-lg border bg-sidebar px-3 py-2 text-sidebar-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo ?? LOGO_PADRAO} alt="" className="size-8 rounded-lg object-cover" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold leading-tight">{nome.trim() || "Medical Spin"}</span>
              <span className="truncate text-xs leading-tight text-muted-foreground">Follow-up WhatsApp v1.15.4</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" onClick={salvar} disabled={pending || !alterado || !nome.trim()}>
            {pending ? <Spinner /> : null}
            Salvar identidade
          </Button>
          {alterado && !pending ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setNome(salvo.nome)
                setLogo(salvo.logo)
              }}
            >
              Descartar
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
