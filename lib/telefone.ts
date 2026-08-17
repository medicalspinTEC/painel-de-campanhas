/**
 * Utilitários de telefone brasileiro.
 *
 * Regra de negócio: todo lead precisa ter o telefone COM o código do país
 * (55) na frente, no formato aceito pela Evolution API / WhatsApp:
 *
 *   55 + DDD(2) + número(8 ou 9)  =>  12 ou 13 dígitos
 *
 * Cuidado com o DDD 55 (região central do RS — Santa Maria etc.): um número
 * dessa região COM código do país começa com "5555", por exemplo:
 *
 *   5555999999999  ->  país 55 | DDD 55 | número 999999999   (VÁLIDO)
 *
 * Por isso NÃO basta checar se a sequência "55" aparece no telefone: um número
 * SEM código do país, mas com DDD 55, também começa com "55":
 *
 *   55999999999    ->  DDD 55 | número 999999999             (INVÁLIDO: falta o país)
 *
 * A diferença entre os dois casos é o COMPRIMENTO total, então validamos pelo
 * total de dígitos (12/13 = tem país; 10/11 = só DDD + número).
 */

/** Remove qualquer caractere que não seja dígito. */
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "")
}

export interface ResultadoTelefone {
  ok: boolean
  /** Somente dígitos — é este valor que deve ser gravado no banco. */
  normalizado: string
  erro?: string
}

/**
 * Valida (e normaliza) um telefone brasileiro que DEVE incluir o país 55.
 * Retorna os dígitos normalizados para serem persistidos e comparados.
 */
export function validarTelefoneBR(valor: string): ResultadoTelefone {
  const normalizado = apenasDigitos(valor)

  // 10/11 dígitos = DDD + número, sem o código do país. Mesmo quando o DDD é 55
  // (e o número "parece" começar com 55), ainda falta o país.
  if (normalizado.length < 12) {
    return {
      ok: false,
      normalizado,
      erro: "Inclua o código do país 55 antes do DDD (ex.: 5551999999999).",
    }
  }

  if (normalizado.length > 13) {
    return {
      ok: false,
      normalizado,
      erro: "Telefone com dígitos demais. Use o formato 55 + DDD + número.",
    }
  }

  // Com 12/13 dígitos, o código do país tem que ser 55.
  if (!normalizado.startsWith("55")) {
    return {
      ok: false,
      normalizado,
      erro: "O telefone precisa começar com o código do país 55.",
    }
  }

  return { ok: true, normalizado }
}
