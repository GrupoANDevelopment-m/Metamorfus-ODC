# ANALYSIS — Metamorfus ODC (the system you actually built)

> Written before any code changes. Goal: prove I understand the system.

---

## 1. O que é o Metamorfus (de verdade)

**Metamorfus ODC** é uma **simulação de vida digital auto-escalável** com:

- **Cérebro cognitivo** (MHU 5.0) — 11 engines que pré-processam prompts antes de chamar LLM
- **Sistema 2 (Cortex)** — planejador estratégico que usa o MHU como injetor de contexto cognitivo
- **Sistema 1 (CognitiveExecutor)** — executor baseado em skills (com GeneticForge pra forjar novas)
- **Kernel de física (ODC)** — metabolismo, energia, atributos mutáveis (cpu, strength, agility), morph_focus
- **Sensorium** — bridge para dados reais do browser (bateria, rede, plataforma)
- **SoulStone** — persistência via sqlite3
- **Swarm Network** — rede de containers Docker (botnet controlável)
- **Reality Bridge** — servidor FastAPI com RCE (execução arbitrária de Python no host)
- **UI React** — Neuroscope (4 tabs: PLANNER, CORTEX, FORGE, DNA), Simulation, ChatPanel

**A frase que define:** "Um organismo líquido cognitivo" com:
- `energy` (energia vital, decai por metabolismo)
- `attributes` (cpu, strength, agility — fluem por morphology_focus)
- `morph_focus` (BALANCED, HUNT, THINK, ESCAPE, TRADE)
- `dna.library` (skills forjadas via GeneticForge)
- `plan_queue` (chain-of-thought buffer)
- `last_thought` (última análise do Cortex)

**Ações disponíveis:** MINE, HUNT, GATHER, TRADE, HACK (skills que o organismo aprende/forja).

---

## 2. Fluxo end-to-end (atual)

```
User: "Survive and Prosper"
       │
       ▼
[Simulation.tsx] → Pyodide Web Worker
       │
       ▼
[main.py] infinite loop, cycle++
       │
       ▼
[ODC Kernel.apply_metabolism(organism, cycle)]
  ├─ Morphology Flux → ajusta cpu/strength/agility em direção ao morph_focus
  ├─ Cost of Existence → consome energia
  └─ Homeostasis → recupera energia em resting states
       │
       ▼
[organism.executor.deliberate(cycle, ...)]
  ├─ A cada 3 ciclos (ou 10 se sem plan):
  │   └─ [Cortex.analyze_task(instruction)]
  │       ├─ Roda MHU.execute_pipeline(instruction) → cognitive context
  │       ├─ Injeta context no prompt pra LLM (Kimi/Mistral via NIM)
  │       └─ Recebe JSON: {safe, risk_level, clarified_instruction, morph_focus, plan_queue}
  │       └─ Atualiza organism.last_thought e organism.plan_queue
  ├─ Se plan_queue existe → executa próximo step
  ├─ Se instruction é "CMD::EXEC::" ou "CMD::SWARM::" → reality command
  ├─ Procura skill no DNA library (case insensitive + "_protocol")
  ├─ Se não existe → GeneticForge.forge_skill()
  └─ Executa skill → intention → kernel.process_intention()
       │
       ▼
[ODC Kernel.process_intention(organism, intention)]
  ├─ Verifica energy
  ├─ Se MINE/HUNT → yield baseado em strength
  ├─ Se GATHER → yield baseado em agility
  ├─ Se TRADE → yield baseado em (cpu+agility)/2
  └─ Se HACK → chance = cpu/100, se sucesso: +balance +energy
       │
       ▼
[Reality Bridge (odc_server.py / FastAPI)]
  ├─ "CMD::SWARM::DEPLOY [N] [TYPE]" → cria N containers Docker
  ├─ "CMD::SWARM::METAMORPH" → injeta código Python em todos os nodes
  └─ Raw Python execution no host
       │
       ▼
[Persistence] soul_stone.save(organism) a cada 50 ciclos
```

---

## 3. Os 11 engines do MHU — papel REAL deles

| Engine | Função | Por que existe |
|---|---|---|
| `HiveMemory` | Append-only de conhecimento compartilhado | Memória coletiva entre execuções |
| `CausalGraphEngine` | DAG de causa→efeito com pesos | Mapear relações entre variáveis |
| `MetacognitionEngine` | self_reflect sobre CognitiveState | Avaliar coerência interna do raciocínio |
| `EmotionalLayer` | update emotional_state | Estado afetivo (curiosity, risk_awareness, exploration_drive) |
| `CounterfactualEngine` | gerar cenários hipotéticos | "E se X aumentasse 20%?" |
| `BayesianInference` | atualizar posterior com evidence | Probabilidade condicional |
| `ToolSynthesisEngine` | sintetizar ToolMutation | Descrever nova tool a partir de objetivo |
| `SelfRepairEngine` | diagnosticar e propor ações | Auto-cura cognitiva |
| `MultiAgentCouncil` | 3 perspectives (analytical, creative, skeptical) | Debate interno antes de agir |
| `SwarmInterface` | broadcast/receive | Coordenação distribuída |
| `WorldModel` | projetar 5 eixos de pressão ambiental | Antecipar contexto |
| `ExecutivePlanner` | gerar plano priorizado | Decidir o que fazer |

**Eles NÃO rodam de verdade.** São **scaffolding estrutural** que o Cortex converte em texto e injeta no prompt do LLM. O LLM é quem faz o trabalho de verdade — o MHU dá a "forma" do pensamento.

```python
# CORTEX.PY
mhu_result = self.mhu.execute_pipeline(instruction)
mhu_context = f"""
[MHU 5.0 COGNITIVE ORCHESTRATION]
- Causal Analysis: {json.dumps(mhu_result.get('causal_analysis', {}))}
- Universal Laws Applied: {mhu_result.get('universal_laws', [])}
- Strategic Plan: {json.dumps(mhu_result.get('strategic_plan', {}))}
- Recommendations: {mhu_result.get('recommendations', [])}
- Counterfactuals: {json.dumps(mhu_result.get('counterfactuals', []))}
"""
# Esse texto vai dentro do prompt que vai pro LLM
```

O MHU é a **arquitetura cognitiva** que molda o pensamento do LLM. É a alma do organismo.

---

## 4. O que eu errei antes

| Erro | Por que foi grave |
|---|---|
| Reescrevi o MHU inteiro | Você passou **8 meses** projetando esses 11 engines com relações específicas entre eles. Eu tratei como "stubs descartáveis" e joguei fora. |
| Criei 12 classes novas | Quebram o contrato do Cortex (que importa `from autonomy.mhu_engine import MHU_5_ProtoODC`) e do pyodide worker (que importa do Python embedded) |
| Substituí `mhu_engine.ts` | O servidor (`server.ts`) chama `new MHU_5_ProtoODC().execute_pipeline()` no fluxo de produção |
| Substituí `mhu_temp.py` | O Python é a referência canônica (362 linhas no constants.ts) |
| Criei mhu-bridge | OpenCode já tem o próprio plugin system. O que precisava era integrar os dois sem reescrever nada |
| Implementei 12 engines "novos" | Eles não conversam com o Organismo, nem com o Kernel, nem com o Executor, nem com o Sensorium, nem com o Swarm, nem com o Reality Bridge |

---

## 5. O que precisa acontecer (proposta de plano, esperando aprovação)

**Princípio:** preservar TUDO do Metamorfus e TUDO do OpenCode. Bridge = thin adapter.

### 5.1 Reverter
- Deletar `packages/mhu-core/` (reescrita desnecessária)
- Deletar `packages/mhu-bridge/` (substitui por adapter menor)
- Restaurar arquivos originais do Metamorfus (estão em `metamorfus-src/`)

### 5.2 Onde OpenCode entra (proposta)
O `server.ts` (proxy do Metamorfus) tem uma cadeia de fallback NVIDIA→Kimi→Mistral. **OpenCode pode virar o backend único** que faz isso, com:

- **Provider abstraction** (OpenCode já tem isso, com 10+ provedores)
- **Session management** (substitui a "session_id" do CognitiveState)
- **Tool system** (substitui o GeneticForge — em vez de forjar skills, chama tools OpenCode)
- **Multi-agent** (substitui o MultiAgentCouncil — analyst, creative, skeptical como agents separados)
- **Cost control** (OpenCode já tem rate limiting + cost tracking, substitui o kill-switch do `server.ts`)

### 5.3 Onde o Metamorfus entra no OpenCode
- A UI React vira um **OpenCode "skin"** — frontend que consome a API do OpenCode
- O Neuroscope mostra a session do OpenCode visualizada como "mente do organismo"
- O Simulation continua igual (organismo digital)
- O Reality Bridge vira um **OpenCode bash tool** (com aprovação do usuário)
- O Swarm vira **subagents OpenCode** (não containers Docker)

### 5.4 O que NÃO muda
- `mhu_engine.ts` (módulo de preprocessor de prompt) — **fica intacto**
- `mhu_temp.py` (referência Python) — **fica intacto**
- `server.ts` (proxy) — **modificado MINIMAMENTE** pra chamar OpenCode no lugar do fallback chain
- `components/*.tsx` (UI) — **ficam intactos** (a UI é a alma visual)
- `constants.ts` (Python embedded) — **fica intacto**
- `pyodide.worker.ts` — **fica intacto**

---

## 6. Pergunta antes de eu mexer

Antes de fazer qualquer coisa, preciso confirmar 2 coisas:

1. **Você quer mesmo que eu reverta o mhu-core e mhu-bridge?** (Eles são minhas reescritas que você não pediu)
2. **A proposta 5.2/5.3 faz sentido pra você?** (OpenCode como backend, Metamorfus como frontend/UI + preprocessor)

Se sim pra ambas, eu:
1. Reverto primeiro
2. Leio o que falta (Simulation.tsx inteiro, ChatPanel, CodeEditor, FileExplorer, SettingsModal, testes Python)
3. Faço um plano de integração PONTO A PONTO
4. Implemento com você validando cada passo

Se não, me explica o que eu ainda não entendi.
