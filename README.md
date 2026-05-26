# Metamorfos ODC Dashboard - Sistema de Interfaces Metacognitivas

Bem-vindo ao **Metamorfos ODC Dashboard**, a central de controle e simulação para o **Metamorfos ODC**, um organismo líquido cognitivo criado por **Antonio Brelo Buaca Ndombe (AN Technology Deep Search)**. Este ecossistema foi projetado com uma arquitetura auto-escalável, metacognitiva e tolerante a falhas.

Este documento serve como o manual definitivo de handover para preparar o sistema completo para o GitHub e guiar o próximo agente de IA no desenvolvimento contínuo da aplicação.

---

## 🌌 Conceito e Arquitetura do Sistema

O Metamorfos ODC opera como uma rede inteligente distribuída integrando interfaces visuais ricas, execução local via WebAssembly (Pyodide), raciocínio bayesiano, planejamento executivo e canais de comunicação com múltiplos modelos de linguagem (LLMs).

O ecossistema é dividido em três camadas principais:

### 1. Núcleo Cognitivo: MHU 5.0 (`mhu_engine.ts`)
O mecanismo MHU 5.0 coordena a orquestração cognitiva do organismo através dos seguintes componentes integrados:
* **CausalGraphEngine**: Analisa densidade causal e cria relações dinâmicas de causa-efeito.
* **MetacognitionEngine**: Modera a coerência interna do raciocínio e avalia a confiança.
* **ExecutivePlanner**: Gera e prioriza metas estratégicas de estabilidade e expansão.
* **BayesianInference**: Atualiza dinamicamente as probabilidades de sucesso baseando-se em novos insights.
* **SelfRepairEngine**: Auto-diagnostica e restaura a estabilidade lógica em caso de inconsistências.
* **CounterfactualEngine & SwarmInterface**: Simula cenários hipotéticos de risco e propaga as descobertas em broadcast distribuído.

### 2. Interface de Usuário (React + Vite)
Uma aplicação SPA de alta fidelidade visual (com o tema Dark de alta percepção estética) contendo:
* **Editor**: Visualização e navegação pelo sistema de arquivos virtuais do organismo.
* **Runtime Loop (Simulation)**: Painel interativo demonstrando loops contínuos de execução e evolução celular do organismo.
* **Comm Link (Chat)**: Canal de comunicação direta conectado aos cérebros cognitivos do Metamorfos.
* **Neuroscope**: Mapeador visual dos padrões de pensamento, DNA metabólico e árvore do Chain-of-Thought (CoT).

### 3. Proxy de Backend Inteligente (`server.ts`)
Um servidor Express de nível de produção que serve de proxy para impedir vazamento de chaves no navegador e implementa:
* **Fila de Fallback de APIs**: Caso uma chamada de modelo falhe ou uma API Key esteja ausente, o sistema transaciona inteligentemente entre Nvidia NIM (`NVIDIA_API_KEY`), Kimi/Moonshot (`KIMI_API_KEY`) e Mistral (`MISTRAL_API_KEY`).
* **Segurança e Controle de Custos (Kill-Switch)**: Monitoramento em tempo real de tokens consumidos na sessão para evitar loops infinitos caros. Ao atingir o limite estipulado, o kill-switch entra em ação automaticamente.
* **Injeção do MHU Pipeline**: Todas as interações do usuário no chat passam primeiro por uma análise enriquecida do pipeline cognitivo do MHU 5.0, fornecendo contexto bayesiano e counterfactual para a IA responder.

---

## 📂 Mapa de Arquivos do Workspace

A estrutura do projeto está organizada de forma modular de acordo com as diretrizes do framework:

* 📄 `/package.json`: Configurações de scripts (Express + Vite) e dependências (como `cors`, `lucide-react`, `tsx` e `vite`).
* 📄 `/metadata.json`: Informações de registro e permissões do frame concedidas para o App.
* 📄 `/vite.config.ts`: Configurações do compilador Vite e injeção controlada de variáveis de ambiente.
* 📄 `/types.ts`: Definições globais de TypeScript (`MindState`, `OrganismState`, `SystemConfig`, `DreamState`, etc.).
* 📄 `/constants.ts`: Definições constantes do sistema interno.
* 📄 `/server.ts`: Servidor Express com a cadeia inteligente de proxy e MHU integration.
* 📄 `/mhu_engine.ts`: O motor de orquestração cognitiva do MHU 5.0.
* 📁 `/components`:
  * 📄 `ChatPanel.tsx` — Painel interativo de diálogo ("Comm Link").
  * 📄 `CodeEditor.tsx` — Painel visual de códigos com editor de sintaxe embutido.
  * 📄 `FileExplorer.tsx` — Árvore de navegação do sistema de arquivos e códigos virtuais.
  * 📄 `Neuroscope.tsx` — Leitor de estados mentais cognitivos e CoT.
  * 📄 `SettingsModal.tsx` — Configurações avançadas e inserção de credenciais de faturamento customizadas.
  * 📄 `Simulation.tsx` — Simulação cibernética e de engenhosidade do organismo.
  * 📄 `pyodide.worker.ts` — Web worker para execução rápida e segura de scripts Python.
* 📄 `/.env.example`: Modelo de declaração de variáveis de ambiente do projeto.

---

## 🛠️ Instruções para Execução Local e Testes

Siga as instruções abaixo para ligar o sistema localmente:

### Requisitos Prévios
* **Node.js** v18 ou superior instalado.
* **npm** v9 ou superior.

### Instalação de Dependências
Na raiz do projeto, instale as dependências executando:
```bash
npm install
```

### Configurar Variáveis de Ambiente
Copie o arquivo `.env.example` para `.env` e preencha com as respectivas chaves de faturamento:
```bash
cp .env.example .env
```

### Inicializar em modo de Desenvolvimento
Execute o comando de dev. Devido à integração full-stack Express + Vite, isto inicializará o servidor Express na porta `3000` suportando Hot Module Replacement do Vite em conjunto com os endpoints Proxy API:
```bash
npm run dev
```
Abra [http://localhost:3000](http://localhost:3000) no seu navegador.

### Compilação e Build de Produção
Para compilar e empacotar o projeto para produção:
```bash
npm run build
npm start
```

---

## 🤖 Manual de Diretrizes para o Próximo Agente de IA

Se você é o agente encarregado de continuar e concluir este trabalho, atente-se rigorosamente às seguintes diretrizes estipuladas pelo usuário e pelo ecossistema:

1. **Preservação de Escopo e Funcionalidades**: Não delete nem altere as lógicas existentes de metacognição, o engine do MHU 5.0 ou a cadeia de fallback de APIs em `server.ts` sem autorização expressa do usuário. Use escalonação incremental.
2. **Strict Type Safety**: Mantenha a integridade dos contratos de tipos (`/types.ts`). Qualquer modificação deve atualizar o scaffold sem quebrar a compilação.
3. **Lazy SDK Initialization**: Garanta que o servidor ou os clientes de APIs nunca quebrem na inicialização caso uma chave ambiental esteja temporariamente ausente. Trate erros graciosamente exibindo feedbacks claros.
4. **Respeito às Restrições de iFrame e Sandbox**: Evite o uso de APIs restritas no navegador (`window.open`, `window.alert`), optando por modais elegantes ou states internos.
5. **Estilo Declarativo**: O sistema é implementado com Tailwind CSS e fonts modernas. Preserve a densidade e o ritmo da tipografia visual.

---
*Ecossistema Metamorfos ODC preparado com êxito e pronto para deploy ou versionamento no GitHub.*
