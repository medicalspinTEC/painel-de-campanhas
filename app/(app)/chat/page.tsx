"use client"

import { useMemo, useState } from "react"
import { Bell, Check, CheckCheck, CircleHelp, Filter, MessageCircle, MoreHorizontal, Paperclip, Search, Send, Smile, UserRound } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type Mensagem = { lado: "lead" | "equipe"; texto: string; horario: string; status?: "lida" | "enviada" }
type Conversa = {
  id: string
  nome: string
  iniciais: string
  telefone: string
  produto: string
  campanha: string
  horario: string
  naoLidas: number
  mensagens: Mensagem[]
}

const conversas: Conversa[] = [
  {
    id: "bruna", nome: "Bruna Martins", iniciais: "BM", telefone: "+55 11 98765-4321", produto: "Avaliação facial", campanha: "Pós-consulta · Setembro", horario: "10:42", naoLidas: 2,
    mensagens: [
      { lado: "equipe", texto: "Oi, Bruna! Como você está se sentindo depois da avaliação?", horario: "Ontem, 16:18", status: "lida" },
      { lado: "lead", texto: "Oi! Foi tudo ótimo, obrigada por perguntar 😊", horario: "Ontem, 16:31" },
      { lado: "lead", texto: "Queria saber também quais são os próximos passos para começar.", horario: "10:39" },
      { lado: "lead", texto: "E se tem algum horário disponível na semana que vem.", horario: "10:42" },
    ],
  },
  {
    id: "ricardo", nome: "Ricardo Nunes", iniciais: "RN", telefone: "+55 11 99812-0044", produto: "Tratamento capilar", campanha: "Leads de setembro", horario: "09:16", naoLidas: 1,
    mensagens: [
      { lado: "equipe", texto: "Olá, Ricardo! Posso ajudar com alguma dúvida sobre o tratamento?", horario: "Ontem, 14:02", status: "lida" },
      { lado: "lead", texto: "Bom dia! Vocês atendem pelo convênio?", horario: "09:16" },
    ],
  },
  {
    id: "camila", nome: "Camila Azevedo", iniciais: "CA", telefone: "+55 21 99123-7788", produto: "Consulta dermatológica", campanha: "Reativação de leads", horario: "Ontem", naoLidas: 0,
    mensagens: [
      { lado: "equipe", texto: "Oi, Camila! Temos novidades na agenda desta semana.", horario: "Ontem, 11:20", status: "lida" },
      { lado: "lead", texto: "Obrigada! Vou conferir e retorno para vocês.", horario: "Ontem, 12:05" },
    ],
  },
  {
    id: "felipe", nome: "Felipe Costa", iniciais: "FC", telefone: "+55 31 98440-1230", produto: "Procedimento estético", campanha: "Interesse em procedimentos", horario: "Segunda", naoLidas: 0,
    mensagens: [
      { lado: "lead", texto: "Pode me enviar mais informações sobre o procedimento?", horario: "Segunda, 15:46" },
      { lado: "equipe", texto: "Claro! Vou separar os detalhes e já te envio.", horario: "Segunda, 15:52", status: "lida" },
    ],
  },
  {
    id: "mariana", nome: "Mariana Oliveira", iniciais: "MO", telefone: "+55 41 99901-6622", produto: "Avaliação corporal", campanha: "Novos contatos", horario: "Segunda", naoLidas: 0,
    mensagens: [
      { lado: "equipe", texto: "Olá, Mariana! Quer agendar sua avaliação?", horario: "Segunda, 10:12", status: "lida" },
      { lado: "lead", texto: "Sim, por favor. De preferência no período da tarde.", horario: "Segunda, 10:28" },
    ],
  },
]

const totalConversasNaoLidas = conversas.filter((conversa) => conversa.naoLidas > 0).length

function horaCurta(horario: string) {
  return horario.includes(":") ? horario.slice(-5) : horario
}

export default function ChatPage() {
  const [conversaAtiva, setConversaAtiva] = useState(conversas[0].id)
  const [busca, setBusca] = useState("")
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false)
  const conversa = conversas.find((item) => item.id === conversaAtiva) ?? conversas[0]
  const conversasVisiveis = useMemo(() => conversas.filter((item) => {
    const correspondeBusca = `${item.nome} ${item.telefone} ${item.produto}`.toLowerCase().includes(busca.toLowerCase())
    return correspondeBusca && (!somenteNaoLidas || item.naoLidas > 0)
  }), [busca, somenteNaoLidas])

  return (
    <div className="flex min-h-[calc(100svh-8rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance md:text-2xl">Chat</h1>
          <p className="text-sm text-muted-foreground">Conversas com leads em um só lugar.</p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <CircleHelp className="size-3.5" /> Protótipo · mensagens de exemplo
        </Badge>
      </div>

      <div className="grid min-h-155 flex-1 grid-cols-1 overflow-hidden rounded-lg border bg-card lg:grid-cols-[minmax(260px,310px)_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_250px]">
        <aside className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
            <div>
              <h2 className="text-sm font-semibold">Conversas</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{conversas.length} leads recentes</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Filtros de conversa" title="Filtros de conversa">
              <Filter className="size-4" />
            </Button>
          </div>
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar lead..." className="pl-8" aria-label="Buscar conversas" />
            </div>
          </div>
          <div className="flex gap-1 px-3 pb-2">
            <Button variant={!somenteNaoLidas ? "secondary" : "ghost"} size="sm" onClick={() => setSomenteNaoLidas(false)}>Todas</Button>
            <Button variant={somenteNaoLidas ? "secondary" : "ghost"} size="sm" onClick={() => setSomenteNaoLidas(true)}>
              Não lidas <span className="ml-1 tabular-nums">{totalConversasNaoLidas}</span>
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversasVisiveis.length ? conversasVisiveis.map((item) => {
              const ultimaMensagem = item.mensagens[item.mensagens.length - 1]
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setConversaAtiva(item.id)}
                  className={cn("flex w-full items-start gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-muted/60", conversaAtiva === item.id && "bg-accent/70")}
                >
                  <Avatar className="mt-0.5 size-10 shrink-0">
                    <AvatarFallback className={cn("text-xs font-semibold", item.naoLidas ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{item.iniciais}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.nome}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{horaCurta(item.horario)}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{ultimaMensagem.texto}</span>
                      {item.naoLidas ? <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{item.naoLidas}</span> : null}
                    </span>
                  </span>
                </button>
              )
            }) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>}
          </div>
        </aside>

        <section className="flex min-h-140 min-w-0 flex-col">
          <header className="flex min-h-16 items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-9 shrink-0"><AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{conversa.iniciais}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{conversa.nome}</h2>
                <p className="truncate text-xs text-muted-foreground">{conversa.telefone}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Notificações" title="Notificações"><Bell className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Mais opções" title="Mais opções"><MoreHorizontal className="size-4" /></Button>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-[linear-gradient(135deg,oklch(0.97_0.018_160)_0%,var(--background)_45%,oklch(0.97_0.012_75)_100%)] px-4 py-5 dark:bg-[linear-gradient(135deg,oklch(0.2_0.02_160)_0%,var(--background)_55%,oklch(0.21_0.018_75)_100%)] sm:px-6">
            <div className="mx-auto rounded-full border bg-background/85 px-3 py-1 text-[11px] text-muted-foreground">Mensagens recentes</div>
            {conversa.mensagens.map((mensagem, index) => (
              <div key={`${conversa.id}-${index}`} className={cn("flex max-w-[88%] flex-col gap-1 sm:max-w-[75%]", mensagem.lado === "equipe" ? "self-end" : "self-start")}>
                <div className={cn("rounded-lg px-3.5 py-2.5 text-sm leading-relaxed shadow-sm", mensagem.lado === "equipe" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card text-card-foreground")}>
                  {mensagem.texto}
                </div>
                <div className={cn("flex items-center gap-1 text-[10px] text-muted-foreground", mensagem.lado === "equipe" && "justify-end")}>
                  <span>{horaCurta(mensagem.horario)}</span>
                  {mensagem.lado === "equipe" ? mensagem.status === "lida" ? <CheckCheck className="size-3.5 text-primary" /> : <Check className="size-3.5" /> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t bg-card p-3 sm:p-4">
            <div className="mb-2 flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Anexar arquivo" title="Anexar arquivo"><Paperclip className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Inserir emoji" title="Inserir emoji"><Smile className="size-4" /></Button>
              <span className="ml-auto text-[11px] text-muted-foreground">Envio ficará disponível em uma próxima etapa</span>
            </div>
            <div className="flex items-end gap-2">
              <Textarea disabled placeholder={`Escreva uma mensagem para ${conversa.nome}...`} className="min-h-12 max-h-28 resize-none bg-muted/40" aria-label="Mensagem para o lead" />
              <Button size="icon" disabled aria-label="Enviar mensagem" title="Enviar mensagem"><Send className="size-4" /></Button>
            </div>
          </div>
        </section>

        <aside className="hidden flex-col border-l 2xl:flex">
          <div className="flex flex-col items-center border-b px-4 py-6 text-center">
            <Avatar className="size-16"><AvatarFallback className="bg-primary/15 text-lg font-semibold text-primary">{conversa.iniciais}</AvatarFallback></Avatar>
            <h2 className="mt-3 text-sm font-semibold">{conversa.nome}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{conversa.telefone}</p>
            <Badge variant="secondary" className="mt-3 gap-1"><MessageCircle className="size-3" /> Lead cadastrado</Badge>
          </div>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><UserRound className="size-3.5" /> Dados do lead</div>
            <dl className="flex flex-col gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Interesse</dt><dd className="mt-0.5 font-medium">{conversa.produto}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Campanha</dt><dd className="mt-0.5 font-medium">{conversa.campanha}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Canal</dt><dd className="mt-0.5 font-medium">WhatsApp</dd></div>
            </dl>
            <div className="border-t pt-4">
              <Button variant="outline" className="w-full" disabled>Ver cadastro completo</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
