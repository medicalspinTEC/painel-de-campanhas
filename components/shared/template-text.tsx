import { cn } from "@/lib/utils"

/**
 * Renderiza o texto de uma mensagem destacando as variáveis dinâmicas
 * (ex.: {{primeiro_nome}}) para que fiquem visualmente identificáveis.
 */
export function TemplateText({ texto, className }: { texto: string; className?: string }) {
  const partes = texto.split(/(\{\{\s*[\w.]+\s*\}\})/g).filter(Boolean)

  return (
    <span className={cn("leading-relaxed", className)}>
      {partes.map((parte, index) => {
        const variavel = parte.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
        if (!variavel) return <span key={index}>{parte}</span>
        return (
          <span
            key={index}
            className="rounded bg-accent px-1 py-0.5 font-mono text-[0.85em] text-accent-foreground"
          >
            {variavel[1]}
          </span>
        )
      })}
    </span>
  )
}
