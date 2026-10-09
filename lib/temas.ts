/**
 * Temas prontos do painel. Cada tema redefine os tokens de cor (primária, fundos,
 * bordas, gráficos, barra lateral) tanto no modo claro quanto no escuro — o CSS
 * correspondente fica em `app/globals.css` e é ativado pelo atributo
 * `data-tema` no <html>. Para criar um tema novo, edite `scripts/gerar-temas.py`.
 *
 * Este arquivo não depende de servidor nem de cliente: é usado pela validação
 * da action, pelo layout (cookie) e pelo seletor nas Configurações.
 */

export type TemaPrevia = {
  background: string
  card: string
  primary: string
  primary_foreground: string
  accent: string
  foreground: string
  muted: string
  chart_2: string
  chart_3: string
}

export type TemaDef = {
  id: string
  nome: string
  descricao: string
  /** Cores usadas só na miniatura do seletor (valores reais de cada modo). */
  previa: { claro: TemaPrevia; escuro: TemaPrevia }
}

export const TEMAS_APP = [
  {
    id: "esmeralda",
    nome: "Esmeralda",
    descricao: "Verde clínico, o visual padrão do painel.",
    previa: {
      claro: { background: "oklch(0.995 0.002 165)", card: "oklch(1 0 0)", primary: "oklch(0.53 0.121 165)", primary_foreground: "oklch(0.985 0.008 165)", accent: "oklch(0.955 0.026 165)", foreground: "oklch(0.19 0.012 165)", muted: "oklch(0.965 0.006 165)", chart_2: "oklch(0.64 0.11 185)", chart_3: "oklch(0.72 0.14 75)" },
      escuro: { background: "oklch(0.165 0.012 165)", card: "oklch(0.215 0.014 165)", primary: "oklch(0.7 0.128 165)", primary_foreground: "oklch(0.18 0.03 165)", accent: "oklch(0.31 0.04 165)", foreground: "oklch(0.965 0.006 165)", muted: "oklch(0.27 0.016 165)", chart_2: "oklch(0.74 0.1 185)", chart_3: "oklch(0.8 0.14 75)" },
    },
  },
  {
    id: "oceano",
    nome: "Oceano",
    descricao: "Azul sereno, ideal para um painel mais corporativo.",
    previa: {
      claro: { background: "oklch(0.995 0.002 250)", card: "oklch(1 0 0)", primary: "oklch(0.52 0.15 250)", primary_foreground: "oklch(0.985 0.008 250)", accent: "oklch(0.955 0.026 250)", foreground: "oklch(0.19 0.012 250)", muted: "oklch(0.965 0.006 250)", chart_2: "oklch(0.64 0.11 210)", chart_3: "oklch(0.72 0.14 75)" },
      escuro: { background: "oklch(0.165 0.012 250)", card: "oklch(0.215 0.014 250)", primary: "oklch(0.72 0.13 250)", primary_foreground: "oklch(0.18 0.03 250)", accent: "oklch(0.31 0.04 250)", foreground: "oklch(0.965 0.006 250)", muted: "oklch(0.27 0.016 250)", chart_2: "oklch(0.74 0.1 210)", chart_3: "oklch(0.8 0.14 75)" },
    },
  },
  {
    id: "violeta",
    nome: "Violeta",
    descricao: "Roxo moderno, com destaque forte e elegante.",
    previa: {
      claro: { background: "oklch(0.995 0.002 295)", card: "oklch(1 0 0)", primary: "oklch(0.5 0.19 295)", primary_foreground: "oklch(0.985 0.008 295)", accent: "oklch(0.955 0.026 295)", foreground: "oklch(0.19 0.012 295)", muted: "oklch(0.965 0.006 295)", chart_2: "oklch(0.64 0.11 330)", chart_3: "oklch(0.72 0.14 165)" },
      escuro: { background: "oklch(0.165 0.012 295)", card: "oklch(0.215 0.014 295)", primary: "oklch(0.73 0.14 295)", primary_foreground: "oklch(0.18 0.03 295)", accent: "oklch(0.31 0.04 295)", foreground: "oklch(0.965 0.006 295)", muted: "oklch(0.27 0.016 295)", chart_2: "oklch(0.74 0.1 330)", chart_3: "oklch(0.8 0.14 165)" },
    },
  },
  {
    id: "rosa",
    nome: "Rosa",
    descricao: "Rosa vibrante, acolhedor e cheio de energia.",
    previa: {
      claro: { background: "oklch(0.995 0.002 350)", card: "oklch(1 0 0)", primary: "oklch(0.54 0.2 350)", primary_foreground: "oklch(0.985 0.008 350)", accent: "oklch(0.955 0.026 350)", foreground: "oklch(0.19 0.012 350)", muted: "oklch(0.965 0.006 350)", chart_2: "oklch(0.64 0.11 15)", chart_3: "oklch(0.72 0.14 250)" },
      escuro: { background: "oklch(0.165 0.012 350)", card: "oklch(0.215 0.014 350)", primary: "oklch(0.74 0.15 350)", primary_foreground: "oklch(0.18 0.03 350)", accent: "oklch(0.31 0.04 350)", foreground: "oklch(0.965 0.006 350)", muted: "oklch(0.27 0.016 350)", chart_2: "oklch(0.74 0.1 15)", chart_3: "oklch(0.8 0.14 250)" },
    },
  },
  {
    id: "laranja",
    nome: "Laranja",
    descricao: "Laranja quente, chama atenção para as ações.",
    previa: {
      claro: { background: "oklch(0.995 0.002 48)", card: "oklch(1 0 0)", primary: "oklch(0.55 0.15 48)", primary_foreground: "oklch(0.985 0.008 48)", accent: "oklch(0.955 0.026 48)", foreground: "oklch(0.19 0.012 48)", muted: "oklch(0.965 0.006 48)", chart_2: "oklch(0.64 0.11 85)", chart_3: "oklch(0.72 0.14 250)" },
      escuro: { background: "oklch(0.165 0.012 48)", card: "oklch(0.215 0.014 48)", primary: "oklch(0.76 0.15 48)", primary_foreground: "oklch(0.18 0.03 48)", accent: "oklch(0.31 0.04 48)", foreground: "oklch(0.965 0.006 48)", muted: "oklch(0.27 0.016 48)", chart_2: "oklch(0.74 0.1 85)", chart_3: "oklch(0.8 0.14 250)" },
    },
  },
  {
    id: "grafite",
    nome: "Grafite",
    descricao: "Cinza sóbrio e neutro, sem cor de destaque forte.",
    previa: {
      claro: { background: "oklch(0.995 0.0007 255)", card: "oklch(1 0 0)", primary: "oklch(0.38 0.03 255)", primary_foreground: "oklch(0.985 0.008 255)", accent: "oklch(0.955 0.0084 255)", foreground: "oklch(0.19 0.0042 255)", muted: "oklch(0.965 0.0021 255)", chart_2: "oklch(0.64 0.11 200)", chart_3: "oklch(0.72 0.14 250)" },
      escuro: { background: "oklch(0.165 0.0042 255)", card: "oklch(0.215 0.0049 255)", primary: "oklch(0.82 0.02 255)", primary_foreground: "oklch(0.18 0.0105 255)", accent: "oklch(0.31 0.016 255)", foreground: "oklch(0.965 0.0021 255)", muted: "oklch(0.27 0.0056 255)", chart_2: "oklch(0.74 0.1 200)", chart_3: "oklch(0.8 0.14 250)" },
    },
  },
] as const satisfies readonly TemaDef[]

export type TemaApp = (typeof TEMAS_APP)[number]["id"]

export const TEMA_PADRAO: TemaApp = "oceano"

/** Nome do cookie que guarda o tema para o servidor já renderizar a cor certa. */
export const TEMA_COOKIE = "tema-app"

export function isTemaApp(valor: unknown): valor is TemaApp {
  return typeof valor === "string" && TEMAS_APP.some((tema) => tema.id === valor)
}

export function temaOuPadrao(valor: unknown): TemaApp {
  return isTemaApp(valor) ? valor : TEMA_PADRAO
}
