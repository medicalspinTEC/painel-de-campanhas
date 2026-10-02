import math, json

# ---------- OKLCH -> sRGB e contraste WCAG ----------
def oklch_to_rgb(L, C, H):
    h = math.radians(H); a = C*math.cos(h); b = C*math.sin(h)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return [min(1,max(0,x)) for x in (r,g,bb)]  # lineares

def lum(c):
    r,g,b = oklch_to_rgb(*c)
    return 0.2126*r + 0.7152*g + 0.0722*b

def contraste(c1, c2):
    a, b = lum(c1), lum(c2)
    if a < b: a, b = b, a
    return (a+0.05)/(b+0.05)

def fmt(c, alpha=None):
    L,C,H = c
    s = f"oklch({L:g} {C:g} {H:g}"
    return s + (f" / {alpha})" if alpha else ")")

# ---------- definição dos temas ----------
# h = matiz; pl/pd = (L, C) do primário no claro/escuro; c3 = matiz do gráfico 3
TEMAS = {
  "esmeralda": dict(h=165, pl=(0.53,0.121), pd=(0.70,0.128), c3=75,  c2=185),
  "oceano":    dict(h=250, pl=(0.52,0.150), pd=(0.72,0.130), c3=75,  c2=210),
  "violeta":   dict(h=295, pl=(0.50,0.190), pd=(0.73,0.140), c3=165, c2=330),
  "rosa":      dict(h=350, pl=(0.54,0.200), pd=(0.74,0.150), c3=250, c2=15),
  "laranja":   dict(h=48,  pl=(0.55,0.150), pd=(0.76,0.150), c3=250, c2=85),
  "grafite":   dict(h=255, pl=(0.38,0.030), pd=(0.82,0.020), c3=250, c2=200),
}

def tokens(t, escuro):
    h = t["h"]
    neutro = t is TEMAS["grafite"]
    k = 0.35 if neutro else 1.0   # grafite quase sem croma
    if not escuro:
        pL, pC = t["pl"]
        primary = (pL, pC, h)
        pfg = (0.985, 0.008, h)
        d = dict(
            background=(0.995, 0.002*k, h), foreground=(0.19, 0.012*k, h),
            card=(1,0,0), card_foreground=(0.19, 0.012*k, h),
            popover=(1,0,0), popover_foreground=(0.19, 0.012*k, h),
            primary=primary, primary_foreground=pfg,
            secondary=(0.965, 0.006*k, h), secondary_foreground=(0.26, 0.02*k, h),
            muted=(0.965, 0.006*k, h), muted_foreground=(0.50, 0.012*k, h),
            accent=(0.955, 0.024*k if neutro else 0.026, h), accent_foreground=(0.33, 0.07*(0.4 if neutro else 1), h),
            border=(0.912, 0.006*k, h), input=(0.912, 0.006*k, h), ring=primary,
            chart_1=primary, chart_2=(0.64, 0.11, t["c2"]), chart_3=(0.72, 0.14, t["c3"]),
            chart_4=(0.42, 0.08, h), chart_5=(0.68, 0.02, h),
            sidebar=(0.982, 0.004*k, h), sidebar_foreground=(0.24, 0.014*k, h),
            sidebar_primary=primary, sidebar_primary_foreground=pfg,
            sidebar_accent=(0.945, 0.026*(0.4 if neutro else 1), h), sidebar_accent_foreground=(0.3, 0.07*(0.4 if neutro else 1), h),
            sidebar_border=(0.912, 0.006*k, h), sidebar_ring=primary,
        )
    else:
        pL, pC = t["pd"]
        primary = (pL, pC, h)
        pfg = (0.18, 0.03*k, h)
        d = dict(
            background=(0.165, 0.012*k, h), foreground=(0.965, 0.006*k, h),
            card=(0.215, 0.014*k, h), card_foreground=(0.965, 0.006*k, h),
            popover=(0.215, 0.014*k, h), popover_foreground=(0.965, 0.006*k, h),
            primary=primary, primary_foreground=pfg,
            secondary=(0.27, 0.016*k, h), secondary_foreground=(0.965, 0.006*k, h),
            muted=(0.27, 0.016*k, h), muted_foreground=(0.72, 0.014*k, h),
            accent=(0.31, 0.04*(0.4 if neutro else 1), h), accent_foreground=(0.94, 0.02*k, h),
            border="oklch(1 0 0 / 10%)", input="oklch(1 0 0 / 15%)", ring=primary,
            chart_1=primary, chart_2=(0.74, 0.10, t["c2"]), chart_3=(0.80, 0.14, t["c3"]),
            chart_4=(0.52, 0.09, h), chart_5=(0.62, 0.02, h),
            sidebar=(0.195, 0.014*k, h), sidebar_foreground=(0.955, 0.006*k, h),
            sidebar_primary=primary, sidebar_primary_foreground=pfg,
            sidebar_accent=(0.3, 0.036*(0.4 if neutro else 1), h), sidebar_accent_foreground=(0.94, 0.02*k, h),
            sidebar_border="oklch(1 0 0 / 10%)", sidebar_ring=primary,
        )
    return d

# ---------- validação de contraste ----------
PARES = [("primary_foreground","primary",4.5), ("foreground","background",7),
         ("card_foreground","card",7), ("muted_foreground","background",4.5),
         ("muted_foreground","muted",4.5), ("secondary_foreground","secondary",7),
         ("accent_foreground","accent",4.5), ("sidebar_foreground","sidebar",7),
         ("sidebar_accent_foreground","sidebar_accent",4.5),
         ("primary","background",3.0),   # texto/ícone do primário sobre a página (UI: 3:1)
         ("primary","card",3.0)]
falhas = 0
for nome, t in TEMAS.items():
    for escuro in (False, True):
        d = tokens(t, escuro)
        for a, b, minimo in PARES:
            if isinstance(d[a], str) or isinstance(d[b], str): continue
            r = contraste(d[a], d[b])
            if r < minimo:
                falhas += 1
                print(f"FALHA {nome:9} {'escuro' if escuro else 'claro ':6} {a} x {b}: {r:.2f} < {minimo}")
print("falhas:", falhas)

# ---------- CSS ----------
def bloco(nome, escuro):
    d = tokens(TEMAS[nome], escuro)
    sel = f':root[data-tema="{nome}"]' + (".dark" if escuro else "")
    linhas = [f"{sel} {{"]
    for k, v in d.items():
        linhas.append(f"  --{k.replace('_','-')}: {v if isinstance(v,str) else fmt(v)};")
    linhas.append("}")
    return "\n".join(linhas)

css = ["/* ───────── Temas prontos (gerado por scripts/gerar-temas.py) ─────────",
       "   Cada tema redefine os tokens para o modo claro e o escuro. O padrão",
       "   (esmeralda) já está em :root/.dark acima; os demais são ativados pelo",
       "   atributo data-tema no <html>. */"]
for nome in TEMAS:
    if nome == "esmeralda": continue
    css.append(bloco(nome, False)); css.append(bloco(nome, True))
open("/tmp/temas.css","w").write("\n\n".join(css)+"\n")

# dados para a UI (prévia dos cartões)
previa = {}
for nome in TEMAS:
    cl, es = tokens(TEMAS[nome], False), tokens(TEMAS[nome], True)
    previa[nome] = {m: {k: fmt(d[k]) for k in ("background","card","primary","primary_foreground","accent","foreground","muted","chart_2","chart_3")} for m, d in (("claro",cl),("escuro",es))}
json.dump(previa, open("/tmp/previa.json","w"), indent=1)
