"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Folder, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { createPastaAction, deletePastaAction, renamePastaAction } from "@/app/actions/campaigns"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { PASTA_NOME_MAX, type CampanhaPastaComContagem } from "@/lib/campanha-pastas"

/** Diálogo de nome, usado para criar e para renomear. */
function NomeDialog({
  aberto,
  onAbertoChange,
  titulo,
  descricao,
  inicial,
  confirmar,
  onConfirmar,
  pendente,
}: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  titulo: string
  descricao: string
  inicial: string
  confirmar: string
  onConfirmar: (nome: string) => void
  pendente: boolean
}) {
  const [nome, setNome] = useState(inicial)

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (v) setNome(inicial)
        onAbertoChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={nome}
          maxLength={PASTA_NOME_MAX}
          placeholder="Nome da pasta"
          aria-label="Nome da pasta"
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && nome.trim() && !pendente) onConfirmar(nome)
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onAbertoChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirmar(nome)} disabled={pendente || !nome.trim()}>
            {confirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NovaPastaButton() {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [pendente, startTransition] = useTransition()

  function criar(nome: string) {
    startTransition(async () => {
      const res = await createPastaAction(nome)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setAberto(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <FolderPlus className="size-4" />
        Nova pasta
      </Button>
      <NomeDialog
        aberto={aberto}
        onAbertoChange={setAberto}
        titulo="Nova pasta"
        descricao="Use pastas para agrupar campanhas. Depois, mova campanhas para ela pelo menu de cada card."
        inicial=""
        confirmar="Criar pasta"
        onConfirmar={criar}
        pendente={pendente}
      />
    </>
  )
}

/** Menu (renomear / excluir) de uma pasta. `aoExcluir` permite voltar à lista principal quando se está dentro dela. */
export function PastaMenu({
  pasta,
  aoExcluir,
}: {
  pasta: { id: string; nome: string }
  aoExcluir?: () => void
}) {
  const router = useRouter()
  const [renomear, setRenomear] = useState(false)
  const [excluir, setExcluir] = useState(false)
  const [pendente, startTransition] = useTransition()

  function salvarNome(nome: string) {
    startTransition(async () => {
      const res = await renamePastaAction(pasta.id, nome)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setRenomear(false)
      router.refresh()
    })
  }

  function remover() {
    startTransition(async () => {
      const res = await deletePastaAction(pasta.id)
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
      setExcluir(false)
      if (res.ok) {
        if (aoExcluir) aoExcluir()
        else router.refresh()
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Ações da pasta ${pasta.nome}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenomear(true)}>
            <Pencil className="size-4" />
            Renomear
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setExcluir(true)}>
            <Trash2 className="size-4" />
            Excluir pasta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NomeDialog
        aberto={renomear}
        onAbertoChange={setRenomear}
        titulo="Renomear pasta"
        descricao="O novo nome vale só para a pasta; as campanhas dentro dela continuam as mesmas."
        inicial={pasta.nome}
        confirmar="Salvar"
        onConfirmar={salvarNome}
        pendente={pendente}
      />

      <AlertDialog open={excluir} onOpenChange={setExcluir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a pasta {pasta.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Só a pasta é excluída. As campanhas que estão nela não são apagadas: voltam para a lista principal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remover} disabled={pendente}>
              Excluir pasta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function PastaCard({ pasta }: { pasta: CampanhaPastaComContagem }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50">
      <Link href={`/campanhas?pasta=${pasta.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Folder className="size-5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{pasta.nome}</span>
          <span className="text-xs text-muted-foreground">
            {pasta.total === 1 ? "1 campanha" : `${pasta.total} campanhas`}
          </span>
        </span>
      </Link>
      <PastaMenu pasta={pasta} />
    </div>
  )
}

/** Ações da pasta aberta: após excluir, volta para a lista principal. */
export function PastaAbertaMenu({ pasta }: { pasta: { id: string; nome: string } }) {
  const router = useRouter()
  return <PastaMenu pasta={pasta} aoExcluir={() => router.push("/campanhas")} />
}
