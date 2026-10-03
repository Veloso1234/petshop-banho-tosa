# 🚀 Guia de Deploy no Netlify — Pet Shop Banho e Tosa

Este projeto está 100% preparado para ser publicado no **Netlify** com banco de dados em nuvem persistente e gratuito via **Supabase**.

---

## 📋 Pré-requisitos (Gratuitos)
1. Conta no [Netlify](https://www.netlify.com/) (gratuita).
2. Conta no [Supabase](https://supabase.com/) (gratuita) para o banco de dados na nuvem.
3. Conta no [GitHub](https://github.com/) (ou GitLab/Bitbucket) para conectar o repositório.

---

## 🗄️ Passo 1: Criar o Banco de Dados no Supabase (2 minutos)

1. Acesse [supabase.com](https://supabase.com/) e crie um novo projeto (ex: `petshop-banho-tosa`).
2. No menu lateral esquerdo do Supabase, clique em **SQL Editor**.
3. Clique em **New query**.
4. Para um banco novo, abra `database/schema.sql`, copie todo o conteúdo, cole no SQL Editor do Supabase e clique em **RUN**.
5. Para atualizar um banco já existente sem apagar dados, execute `database/migration_atendimento_fields.sql` no SQL Editor. A migração é segura para reexecução e preserva os registros.
6. A tabela `fichas` mantém suporte ao fuso horário de São Paulo (`America/Sao_Paulo`).
7. Agora vá em **Project Settings** (ícone de engrenagem) -> **API** e copie:
   - **Project URL** (ex: `https://xyzcompany.supabase.co`)
   - **anon / public key** (uma chave longa que começa com `ey...`)

---

## 🌐 Passo 2: Publicar no Netlify

### Opção A: Deploy via GitHub (Recomendada)
1. Suba este projeto para um repositório seu no GitHub.
2. No painel do Netlify, clique em **Add new site** -> **Import an existing project**.
3. Selecione o GitHub e escolha o repositório do Pet Shop.
4. As configurações de Build serão detectadas automaticamente pelo arquivo `netlify.toml`:
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
5. Antes de clicar em Deploy, clique em **Environment variables** e adicione as 2 variáveis:
   - `SUPABASE_URL` = (Cole a sua Project URL do Supabase)
   - `SUPABASE_KEY` = (Cole a sua anon public key do Supabase)
6. Clique em **Deploy site**.

### Opção B: Deploy via Netlify CLI (Linha de Comando)
Se você tem a `netlify-cli` instalada:
```bash
netlify init
netlify env:set SUPABASE_URL "https://seu-projeto.supabase.co"
netlify env:set SUPABASE_KEY "sua-chave-anon"
netlify deploy --prod
```

---

## 🖥️ URLs Finais de Acesso

Após a publicação, o site fornecerá os dois links:

1. **Tela do Caixa (Funcionária):**
   `https://SEU-SITE.netlify.app/caixa.html` (ou simplesmente `https://SEU-SITE.netlify.app/`)

2. **Tela da TV (Banho e Tosa):**
   `https://SEU-SITE.netlify.app/tv.html`

---

## 🔄 Como Funciona o Tempo Real no Netlify

- **Sincronização em Tempo Real:** Localmente, Socket.IO propaga alterações imediatamente. No Netlify, a TV consulta somente a lista sanitizada de fichas do dia a cada 2.5 segundos e o Caixa atualiza a lista de agendamentos ativos a cada 4 segundos, sem depender de estado de memória entre execuções serverless.
- **BroadcastChannel:** Se a tela do Caixa e a da TV forem abertas no mesmo computador/navegador, a sincronização ocorre em **0ms (instantânea)**.
- **Fuso Horário:** Todo o sistema opera com `America/Sao_Paulo`, garantindo que viradas de dia e agendamentos não sofram alterações por fuso horário dos servidores globais.
- Configure `SUPABASE_URL` e `SUPABASE_KEY` nas variáveis do Netlify. Se estiverem ausentes no ambiente Netlify, a função falha explicitamente em vez de tentar usar o SQLite efêmero local.
- Os eventos Socket.IO da TV são enviados com uma lista permitida de campos públicos. Telefone, valor, endereço, nome do tutor e observações não fazem parte do payload da TV.
