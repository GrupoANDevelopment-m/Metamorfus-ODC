# Metamorfus ODC — estado verificado

Medido em 2026-11-07. Todos os números abaixo vêm de execuções reais neste
workspace, com o código real do repositório. Nada aqui é projeção.

Commit: `9acf6ae` · repositório: `GrupoANDevelopment-m/Metamorfus-ODC`

---

## 1. Testes

| Suíte | Resultado | Como rodar |
|---|---|---|
| Bateria viva T1–T18 | **19/19** | `bash .run-battery.sh` (precisa de `NVIDIA_API_KEY`) |
| Suíte offline | **92/92** | `tsx --test server/__tests__/*.mjs` (sem chave) |
| CI no GitHub | **verde** | node 20 ✅ · node 22 ✅ · bateria ✅ · docker ✅ |

A suíte offline passou 3 vezes seguidas sem uma falha (o CI tinha pego uma
corrida de socket — ver §7).

---

## 2. As skills são reais? (T17 — auditoria de alcançabilidade)

Contar arquivos não prova nada. O T17 invoca **todas** as skills do manifesto
pelo invoker real (um `python3` de verdade) e classifica o desfecho honestamente.

```
54 no manifesto  (53 vivas + 1 aposentada)
44 EXECUTARAM e devolveram valor real
 0 alcançável, faltou contexto no audit
 1 degradou — reportou a condição com honestidade
 8 alcançáveis, falta ferramenta externa
 0 QUEBRADOS (bug real)
```

### "Degradado" não é "quebrado"

Uma skill que rodou e devolveu `{"error": "playwright failed: Executable
doesn't exist"}` está **funcionando** — contou a verdade sobre o ambiente
dela. Só uma skill que **levantou exceção** está com defeito. O invoker
prefixa os próprios defeitos com `invoker:`, e é isso que separa as duas
coisas. Antes, as duas eram chamadas de "quebrado".

As 8 que precisam de ferramenta externa: `nginx`, `archify`, `bsk`,
`browser_use`, `browser-harness`, `agent_reach`, `github-mcp-server` e uma
skill que precisa de um servidor HTTP vivo. Nenhuma delas é defeituosa —
todas reportam com precisão o que falta no ambiente.

---

## 3. O achado que estava escondido (o bug de verdade)

`analyze_pressure_gradient_protocol` lê
`stations[{ id, pressure, lat, lon }]`. **Todo** chamador do repositório
enviava `{ station_id, pressure_hpa }`.

Então a pressão chegava como `0`. Todo gradiente saía `0`. O campo parecia
perfeitamente plano. E a chamada devolvia `ok: true`, porque nada tinha
quebrado — a skill estava respondendo a uma pergunta que ninguém tinha
feito.

`engineer_load_calc_protocol` tinha a mesma forma: lê
`loads{ moment, shear, axial, length }` e `section{ type, depth, width }`,
e os chamadores mandavam `distributed_kg_m2`, `span_m`, `depth_m`,
`width_m`. Usava os defaults toda vez e reportava `utilisation: 0`.

**Esse era o mecanismo do falso "ganho de 64.7% entre domínios":** dois dos
três domínios não contribuíam nada enquanto reportavam sucesso. Um teste que
afirma "a fusão vence o baseline" não consegue ver isso — a fusão continua
vencendo, só por um motivo errado.

### A classe do bug agora está fechada

`server/__tests__/skill-contracts.test.mjs` envia o contexto documentado para
cada skill documentada e afirma que a saída **não é degenerada** — gradientes
calculados, utilisation acima de zero, RSI dentro da faixa, temperaturas de
verdade lidas. Se alguém reescrever a skill, renomear um campo ou deixar o
adaptador divergir, o teste falha em vez de devolver zeros em silêncio.

---

## 4. A fusão entre domínios funciona de verdade? (T12)

| cenário | baseline | só trader | melhor isolado | 2 domínios | 3 domínios |
|---|---|---|---|---|---|
| domínios concordam | 4.365 | 3.570 | 3.570 | 1.185 | **0.878 (−79.9%)** |
| trader constantemente errado | 1.778 | 2.670 | 1.252 | 0.325 | **0.764 (−57.1%)** |

No cenário de desacordo o trader **abstém** de propósito: o RSI está travado
em 100, mas o perfil de meteorologia mostra que o campo está **ganhando
energia** — e a faixa que o RSI assume não existe ali. A meteorologia vota a
direção, a engenharia modula a magnitude (headroom 0.41, ×1.21), e a fusão
termina mais perto da verdade do que qualquer domínio isolado.

Todos os três domínios agora reportam leitura real:

```
meteorologia  rates [0.004, 0.009, 0.007, 0.002]  recent -78.8% (decaying)
engineering  utilisation [0.378, 0.459, 0.560, 0.614]  headroom 0.39 → x1.10
trader       rsi=100 (overbought)
```

---

## 5. O organismo cria capacidades? (T6, T13, T18)

| Teste | Resultado |
|---|---|
| T6 — auto-evolução | A skill original **falhou de verdade** (verificado: `failureKind: raised`); o LLM escreveu 3735 bytes de Python que executa e aguenta também uma entrada válida |
| T13 — forja automática | F1 0.571 → 1.000 em dado retido (avaliação honesta) |
| T18 — forja de capacidade | criada, registrada, executada — e **no workspace**, não no pacote instalado |

O T6 agora **afirma a premissa** antes de afirmar o resultado: se a skill
original não falhar, o teste falha. Uma skill que *reporta* uma condição está
funcionando; só uma skill que *levanta* está quebrada. Sem essa checagem, o
teste degradava sozinho em verde quando a skill melhorava.

---

## 6. Statistical honesty

| Teste | Resultado | Nota |
|---|---|---|
| T14 | **não significativo** (ICs se sobrepõem) | reportado como não significativo, não como vitória |
| T15 | F1 0.933 CI [0.833, 1.000] | PaySim-like, k=10 |
| T16 | baseline 0.967 CI [0.891, 1.000] | a forja não melhorou — e isso está escrito |

Nada é arredondado a partir de uma execução feliz. Onde o resultado não
significa nada, o relatório diz que não significa nada.

---

## 7. O que foi corrigido nesta rodada

| Lacuna | Correção |
|---|---|
| **OpenCode nunca falava** | O bridge falava em 5 pontos do protocolo real (health path, shape da resposta, `ModelRef` como string, usage, model/provider). `/api/chat` caía no fallback e o caminho OpenCode nunca-engatou. Teste de contrato novo — **falha com o bridge antigo, passa com o novo**. |
| **Seeds divergiam do disco** | 30 seeds Python divergiam dos `.py` que o repo entrega. Um workspace novo começava o organismo com skills mais fracas do que o repo contém — e nenhum dos dois arquivos denunciava. Agora são sincronizados byte a byte. |
| **4 skills inalcançáveis** | `sharpen_axe` (shell), `navigate_forest` (JS), `weather_read` e `material_selection` (spec) eram declaradas com runtimes que o runner ignorava. O runner agora despacha por runtime. |
| **Campos que ninguém enviava** | Ver §3. |
| **Registro de modelos apodrecendo** | `z-ai/glm-5.3` estava vivo em 2026-10-23 e aposentado em 2026-10-28 — foi o que quebrou o T14 em 2026-10-29. O registro agora se sonda sozinho e aposenta um modelo **só** em 404/410 explícito. Timeout, 429 e 5xx não provam nada. Verificado contra a API real. |
| **Corrida de socket no CI** | As portas de teste eram fixas ou aleatórias; o undici guarda socket keep-alive por `host:port`, e o teste seguinte fetchava por um socket morto. Node 20 e Node 22 reciclam o pool diferente — por isso só o 22 falhou. Agora toda porta de teste é efêmera, escolhida pelo SO. |
| **54 MB de cruft** | `artifacts/` do upstream (7.9 MB, não referenciado por nada) e 3 fixtures gigantes (11.6 MB) removidos. Os 42 MB de vídeos da landing page do console e os ícones do desktop **ficaram**: o console importa os vídeos e o build do desktop referencia os ícones — removê-los quebraria um alvo de build. |

---

## 8. Tamanho do repositório, honestamente

| | |
|---|---|
| Conteúdo versionado | **108.7 MB** |
| Histórico `.git` | 88 MB |
| Árvore de trabalho com `node_modules` | 276 MB |

O OpenCode vendorizado são 125 MB, dos quais **74.6 MB são binários**
(vídeos, ícones, fontes, screenshots). O clone continua maior do que o
código precisa, porque o histórico do Git guarda blobs que a árvore de
trabalho já não tem. Encolher mais significa reescrever o histórico — o que
muda o SHA de cada commit. Isso é uma decisão, não uma limpeza, e não foi
feita em silêncio.

---

## 9. O que NÃO está pronto

Pra fechar com honestidade:

1. **Os 8 adaptadores de ferramenta externa** precisam do programa instalado.
   Funcionam: detectam a ausência e dizem qual é. Num deploy de produção,
   a imagem instala o que for usado.
2. **O console/app/web/desktop do OpenCode não está ligado** à UI do
   Metamorfus. O que é real: o bridge HTTP + o sidecar em Docker.
3. **A suíte OpenCode não roda aqui** — não há `bun` nem `node_modules` do
   OpenCode neste sandbox. A integração é verificada **estaticamente contra
   o código-fonte real do servidor** e por um **teste de contrato** que serve
   os shapes reais. O sidecar em si só é verificado pelo build da imagem.
4. **O coeficiente de emissão do modelo é uma escolha dele.** O LLM escreveu
   0.12 kg CO₂/t·km para-road (o valor mais citado é 0.062). A skill declara o
   próprio fator — 1200 kg contra 620 kg. Não é erro do sistema; é o modelo
   escolhendo um número. A skill declara isso para que ninguém confunda.
5. **O repo ainda tem 19 seeds escritas à mão** (com tabelas de domínio) e
   6 de cálculo puro. O resto — todo `evolved_*` e `forged_*` — foi escrito
   pelo LLM. A divisão está registrada; não está misturada.

---

## 10. Como reproduzir tudo

```bash
cd packages/metamorfus-src
export NVIDIA_API_KEY=nvapi-...
export MAX_TOKENS_PER_SESSION=20000000

bash .run-battery.sh          # 19/19, ~5 min

unset NVIDIA_API_KEY
./node_modules/.bin/tsx --test \
  server/__tests__/cognitive.test.mjs server/__tests__/archaeology.test.mjs \
  server/__tests__/identity.test.mjs server/__tests__/constitution-memory.test.mjs \
  server/__tests__/llm-library.test.mjs server/__tests__/model-liveness.test.mjs \
  server/__tests__/capability-forge.test.mjs server/__tests__/opencode-bridge.test.mjs \
  server/__tests__/skill-runtimes.test.mjs server/__tests__/skill-contracts.test.mjs \
  server/__tests__/tool-registry.test.ts
```
