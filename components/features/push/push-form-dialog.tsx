"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { BellRing, Send } from "lucide-react"
import { toast } from "sonner"

import { enviarTestePushAction, estimarAlcancePushAction, salvarPushAction } from "@/app/actions/push"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { UserRole } from "@/lib/permissoes"
import {
  CORPO_MAX,
  DESTINOS_PUSH,
  FUSO_PUSH,
  MODOS_PUSH,
  PUBLICOS_PUSH,
  TITULO_MAX,
  type ModoEnvioPush,
  type PublicoPush,
  type PushItem,
  type UsuarioPush,
} from "@/lib/push"

const OUTRO = "__outro"
const NIVEIS: { key: UserRole; label: string }[] = [
  { key: "root", label: "Root" },
  { key: "admin", label: "Administradores" },
  { key: "padrao", label: "Usuários padrão" },
]
const LOCAL_FMT = "yyyy-MM-dd'T'HH:mm"

export function PushFormDialog({
  open,
  onOpenChange,
  modelo,
  editando,
  usuarios,
  configurado,
  onSalvo,
}: {
  open: boolean
  onOpenChange: (aberto: boolean) => void
  /** Notificação usada como ponto de partida (editar ou duplicar). */
  modelo: PushItem | null
  /** `true` = altera `modelo`; `false` = cria uma nova a partir dele (duplicar). */
  editando: boolean
  usuarios: UsuarioPush[]
  configurado: boolean
  onSalvo: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [testando, setTestando] = useState(false)

  const [titulo, setTitulo] = useState("")
  const [corpo, setCorpo] = useState("")
  const [destino, setDestino] = useState("/")
  const [destinoOutro, setDestinoOutro] = useState("")
  const [imagem, setImagem] = useState("")
  const [urgente, setUrgente] = useState(false)
  const [publico, setPublico] = useState<PublicoPush>("todos")
  const [papeis, setPapeis] = useState<UserRole[]>([])
  const [usuarioIds, setUsuarioIds] = useState<string[]>([])
  const [somenteInstalados, setSomenteInstalados] = useState(true)
  const [modo, setModo] = useState<ModoEnvioPush>("agora")
  const [agendadaPara, setAgendadaPara] = useState("")
  const [alcance, setAlcance] = useState<{ aparelhos: number; usuarios: number } | null>(null)

  const opcoesDestino = useMemo(() => [...DESTINOS_PUSH, { value: OUTRO, label: "Outro endereço…" }], [])

  // O diálogo é reaproveitado: recarrega os campos sempre que abre.
  useEffect(() => {
    if (!open) return
    setTitulo(modelo?.titulo ?? "")
    setCorpo(modelo?.corpo ?? "")
    const url = modelo?.url ?? "/"
    const conhecido = DESTINOS_PUSH.some((d) => d.value === url)
    setDestino(conhecido ? url : OUTRO)
    setDestinoOutro(conhecido ? "" : url)
    setImagem(modelo?.imagem ?? "")
    setUrgente(modelo?.urgente ?? false)
    setPublico(modelo?.publico ?? "todos")
    setPapeis(modelo?.papeis ?? [])
    setUsuarioIds(modelo?.usuarioIds ?? [])
    setSomenteInstalados(modelo?.somenteInstalados ?? true)
    setModo(editando ? (modelo?.status === "agendada" ? "agendar" : "rascunho") : "agora")
    setAgendadaPara(editando && modelo?.agendadaPara ? formatInTimeZone(new Date(modelo.agendadaPara), FUSO_PUSH, LOCAL_FMT) : "")
    setAlcance(null)
  }, [open, modelo, editando])

  // Alcance estimado do público (aparelhos e usuários), atualizado enquanto o Root escolhe.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      const resultado = await estimarAlcancePushAction({ publico, papeis, usuarioIds, somenteInstalados }).catch(() => null)
      setAlcance(resultado)
    }, 350)
    return () => clearTimeout(timer)
  }, [open, publico, papeis, usuarioIds, somenteInstalados])

  const url = destino === OUTRO ? destinoOutro : destino
  const entrada = { titulo, corpo, url, imagem, urgente, publico, papeis, usuarioIds, somenteInstalados, modo, agendadaPara }
  const minimoAgenda = formatInTimeZone(new Date(Date.now() + 2 * 60_000), FUSO_PUSH, LOCAL_FMT)

  function alternar<T>(lista: T[], valor: T, marcado: boolean): T[] {
    return marcado ? [...lista, valor] : lista.filter((item) => item !== valor)
  }

  function salvar() {
    startTransition(async () => {
      const resultado = await salvarPushAction(entrada, editando ? modelo?.id : undefined)
      if (resultado.ok) {
        toast.success(resultado.message)
        onSalvo()
        onOpenChange(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  async function testar() {
    setTestando(true)
    try {
      const resultado = await enviarTestePushAction({ titulo, corpo, url, imagem, urgente })
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    } finally {
      setTestando(false)
    }
  }

  const rotulo = editando
    ? modo === "agora"
      ? "Salvar e enviar agora"
      : modo === "agendar"
        ? "Salvar agendamento"
        : "Salvar rascunho"
    : modo === "agora"
      ? "Enviar agora"
      : modo === "agendar"
        ? "Agendar envio"
        : "Salvar rascunho"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editando ? "Editar notificação" : modelo ? "Duplicar notificação" : "Nova notificação"}</DialogTitle>
          <DialogDescription>
            Aparece no aparelho de quem instalou o app, mesmo com ele fechado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <Field>
            <FieldLabel htmlFor="push-titulo">Título</FieldLabel>
            <Input id="push-titulo" value={titulo} maxLength={TITULO_MAX} onChange={(e) => setTitulo(e.target.value)} placeholder="Atualização disponível" />
          </Field>

          <Field>
            <FieldLabel htmlFor="push-corpo">Mensagem</FieldLabel>
            <Textarea id="push-corpo" value={corpo} maxLength={CORPO_MAX} rows={3} onChange={(e) => setCorpo(e.target.value)} placeholder="Novidades no painel de campanhas. Toque para ver." />
            <FieldDescription>
              {corpo.length}/{CORPO_MAX} caracteres. Textos curtos aparecem inteiros na tela de bloqueio.
            </FieldDescription>
          </Field>

          {/* Prévia aproximada de como a notificação aparece no aparelho. */}
          <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3">
            <img src="/icons/icon-192.png" alt="" className="size-9 rounded-lg" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{titulo || "Título da notificação"}</span>
              <span className="line-clamp-3 text-xs text-muted-foreground">{corpo || "A mensagem aparece aqui."}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="push-destino">Ao tocar, abrir</FieldLabel>
              <SelectField id="push-destino" value={destino} onValueChange={setDestino} opcoes={opcoesDestino} />
            </Field>
            {destino === OUTRO ? (
              <Field>
                <FieldLabel htmlFor="push-destino-outro">Endereço</FieldLabel>
                <Input id="push-destino-outro" value={destinoOutro} onChange={(e) => setDestinoOutro(e.target.value)} placeholder="/leads ou https://…" />
              </Field>
            ) : null}
          </div>

          <Field>
            <FieldLabel htmlFor="push-imagem">Imagem (opcional)</FieldLabel>
            <Input id="push-imagem" value={imagem} onChange={(e) => setImagem(e.target.value)} placeholder="https://… (aparece em Android e no computador)" inputMode="url" />
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="push-urgente" className="text-sm font-medium">
                Prioridade alta
              </label>
              <span className="text-sm text-muted-foreground">Fica na tela até a pessoa tocar ou dispensar.</span>
            </div>
            <Switch id="push-urgente" checked={urgente} onCheckedChange={setUrgente} />
          </div>

          <div className="flex flex-col gap-3 rounded-xl border p-3">
            <Field>
              <FieldLabel htmlFor="push-publico">Quem recebe</FieldLabel>
              <SelectField id="push-publico" value={publico} onValueChange={(v) => setPublico(v as PublicoPush)} opcoes={PUBLICOS_PUSH} />
            </Field>

            {publico === "papeis" ? (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {NIVEIS.map((nivel) => (
                  <label key={nivel.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={papeis.includes(nivel.key)} onChange={(e) => setPapeis((atual) => alternar(atual, nivel.key, e.target.checked))} />
                    {nivel.label}
                  </label>
                ))}
              </div>
            ) : null}

            {publico === "usuarios" ? (
              usuarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum usuário ativou as notificações ainda.</p>
              ) : (
                <ul className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2">
                  {usuarios.map((u) => (
                    <li key={u.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={usuarioIds.includes(u.id)} onChange={(e) => setUsuarioIds((atual) => alternar(atual, u.id, e.target.checked))} />
                        <span className="truncate">{u.nome}</span>
                        <span className="text-xs text-muted-foreground">
                          @{u.username} · {u.aparelhos} {u.aparelhos === 1 ? "aparelho" : "aparelhos"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label htmlFor="push-instalados" className="text-sm font-medium">
                  Só quem instalou o app
                </label>
                <span className="text-sm text-muted-foreground">Ignora aparelhos que ativaram pelo navegador, sem instalar.</span>
              </div>
              <Switch id="push-instalados" checked={somenteInstalados} onCheckedChange={setSomenteInstalados} />
            </div>

            <p className="text-xs text-muted-foreground">
              {alcance === null
                ? "Calculando o alcance…"
                : `Alcance hoje: ${alcance.aparelhos} ${alcance.aparelhos === 1 ? "aparelho" : "aparelhos"} de ${alcance.usuarios} ${alcance.usuarios === 1 ? "usuário" : "usuários"}.`}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="push-modo">Quando enviar</FieldLabel>
              <SelectField id="push-modo" value={modo} onValueChange={(v) => setModo(v as ModoEnvioPush)} opcoes={MODOS_PUSH} />
            </Field>
            {modo === "agendar" ? (
              <Field>
                <FieldLabel htmlFor="push-agenda">Data e hora (Brasília)</FieldLabel>
                <Input id="push-agenda" type="datetime-local" min={minimoAgenda} value={agendadaPara} onChange={(e) => setAgendadaPara(e.target.value)} />
              </Field>
            ) : null}
          </div>

          {!configurado && modo !== "rascunho" ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              As chaves VAPID ainda não estão configuradas no servidor: dá para salvar como rascunho, mas não enviar nem agendar.
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => void testar()} disabled={testando || pending || !configurado || !titulo.trim() || !corpo.trim()}>
            {testando ? <Spinner /> : <BellRing className="size-4" />}
            Testar em mim
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={salvar} disabled={pending}>
              {pending ? <Spinner /> : <Send className="size-4" />}
              {rotulo}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
