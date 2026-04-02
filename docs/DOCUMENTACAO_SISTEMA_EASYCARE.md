# Documentacao Completa do Sistema EasyCare

## 1. Visao Geral

O EasyCare e um sistema web para gestao de ILPI (Instituicao de Longa Permanencia para Idosos), com arquitetura multi-tenant.

Cada organizacao possui seus proprios dados de:
- residentes
- equipe
- prontuario
- medicacoes
- escalas
- ocorrencias
- financeiro

Existe tambem:
- painel de super admin (cross-organizacao)
- portal da familia

## 2. Arquitetura Tecnica

### 2.1 Stack

- Frontend: React 18 + TypeScript + Vite + Wouter + TanStack Query + Tailwind/shadcn
- Backend: Node.js + Express + TypeScript
- Banco: PostgreSQL + Drizzle ORM
- Sessao: `express-session` + `connect-pg-simple`
- Seguranca de senha: PBKDF2-SHA256 com rehash automatico

### 2.2 Estrutura de pastas

- `client/`: interface web
- `server/`: API, autenticacao, regras de negocio
- `shared/`: contratos compartilhados (schema, rotas, regras de ambiente)
- `script/build.ts`: build de frontend + backend para producao

## 3. Multi-Tenancy e Autenticacao

### 3.1 Modelo de isolamento

- Usuario de organizacao sempre trabalha dentro de `organizationId`
- Super admin e global e gerencia todas as organizacoes
- Portal de familia tem sessao separada (`session.familyMember`)

### 3.2 Login

- Rota principal: `POST /api/auth/login`
- Login por organizacao usando `organizationCnpj` + `username` + `password`
- Super admin loga sem organizacao
- Usuarios inativos nao entram
- Organizacoes inativas/restritas bloqueiam acesso

### 3.3 Sessao

- Cookie de sessao: `easycare.sid`
- Store em tabela `user_sessions`

## 4. Permissoes (RBAC)

O sistema usa dois niveis por modulo:
- `view` (visualizacao)
- `edit` (edicao)

### 4.1 Conceitos

- `roleRoutes`: modulos que o papel pode ver
- `roleEditRoutes`: modulos que o papel pode editar

### 4.2 Regra forte de seguranca

No backend:
- requisicoes `GET/HEAD/OPTIONS` exigem permissao de `view`
- requisicoes `POST/PUT/PATCH/DELETE` exigem permissao de `edit`

Ou seja: quem tem so visualizacao nao salva/edita nada em nenhum modulo.

### 4.3 Papeis padrao

Papeis de sistema padrao:
- `admin`
- `enfermeiro`
- `medico`
- `tecnico_enfermagem`
- `cuidador`
- `fisioterapeuta`
- `nutricionista`
- `recepcionista`
- `administrativo`
- `staff` (colaborador)

Cargos de equipe padrao (select da tela Equipe):
- `cuidador`
- `enfermeiro`
- `tecnico_enfermagem`
- `medico`
- `fisioterapeuta`
- `nutricionista`
- `recepcionista`
- `administrativo`

## 5. Modulos Funcionais

### 5.1 Dashboard

- KPIs principais da organizacao
- ocupacao
- medicacoes ativas
- ocorrencias pendentes
- dados financeiros

### 5.2 Residentes

- cadastro completo (dados pessoais, saude e contato)
- status do residente
- foto do residente
- abertura de detalhes por linha

### 5.3 Prontuario

- registros clinicos (`medical_records`)
- comorbidades/diagnosticos (`comorbidities`)
- familiares (`family_members`)

### 5.4 Medicacoes

- cadastro de medicamento por residente
- registro de administracao (`medication_administrations`)
- rastreabilidade de quem administrou
- para cuidador: so pode registrar como ele mesmo

### 5.5 Equipe

- cadastro completo de colaborador (CLT/PJ, docs, contato, foto)
- jornada recorrente por:
  - dia da semana
  - dias pares/impares
  - datas bloqueadas
- acesso ao portal por colaborador:
  - `portalAccess`
  - `portalUsername`
  - senha inicial/alteracao
- sincronizacao com tabela `users` para login real

### 5.6 Escalas

- criacao manual de plantao
- geracao mensal automatica
- validacoes:
  - sem sobreposicao
  - respeita jornada do colaborador
  - respeita regras do perfil (ex: 12x36)
  - respeita descanso minimo entre plantoes
- dispensar dia especifico (bloqueia data e remove plantao daquele dia)

### 5.7 Ocorrencias

- abertura e acompanhamento por gravidade e status
- resolucao e data de resolucao

### 5.8 Financeiro

- contratos por residente
- mensalidades por contrato/residente
- status de pagamento e indicadores

### 5.9 Configuracao de Ambiente

- cadastro de papeis/cargos
- matriz de permissao por modulo (ver/editar)
- perfis de jornada e regras (duracao, descanso, tipos permitidos)

### 5.10 Super Admin

- CRUD de organizacoes
- status da organizacao: `active`, `inactive`, `restricted`
- CRUD de usuarios por organizacao

### 5.11 Portal da Familia

- login de familiar
- visao de residente, registros compartilhados, medicacoes e ocorrencias filtradas

## 6. Regras de Negocio Relevantes

## 6.1 Status de organizacao

- `active`: acesso normal
- `inactive`: acesso bloqueado
- `restricted`: acesso bloqueado com mensagem de restricao

## 6.2 Cuidador so atua em si mesmo

Em acoes sensiveis (escala e administracao de medicamento):
- se papel for `cuidador`, o sistema obriga vinculo ao proprio colaborador
- nao pode selecionar outro profissional

## 6.3 Geracao mensal de escalas

- usa agenda recorrente configurada no colaborador
- pares/impares tem prioridade sobre dia da semana
- ignora datas bloqueadas
- cria notas internas com prefixo `[AUTO-MONTH:YYYY-MM]`
- pode limpar escalas geradas automaticamente antes de gerar novamente

## 6.4 Perfil de jornada com regra (ex: 12x36)

Permite definir:
- horas exatas do plantao
- descanso minimo entre plantoes
- tipos de plantao permitidos (`12h_manha`, `12h_noite`, `24h`, `avulso`)

## 6.5 Acesso ao portal para colaborador

Ao ativar/desativar no cadastro de equipe:
- cria/atualiza/desativa usuario em `users`
- vincula via `portalUserId` + `portalUsername`

## 7. Modelo de Dados (Resumo)

Tabelas principais:

- `organizations`: tenant, dados da instituicao, status, configuracoes do ambiente
- `users`: login de sistema por organizacao e super admin
- `residents`: residentes
- `family_members`: familiares e acesso portal familia
- `staff`: colaboradores e jornada
- `shift_assignments`: escalas
- `medications`: medicamentos prescritos
- `medication_administrations`: administracoes realizadas
- `medical_records`: registros de prontuario
- `comorbidities`: diagnosticos/comorbidades
- `occurrences`: ocorrencias operacionais
- `contracts`: contratos financeiros
- `monthly_fees`: mensalidades
- `user_sessions`: sessoes web

## 8. API (Resumo por Dominio)

### 8.1 Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 8.2 Portal Familia

- `POST /api/family-portal/login`
- `POST /api/family-portal/logout`
- `GET /api/family-portal/me`
- `GET /api/family-portal/resident`
- `GET /api/family-portal/medical-records`
- `GET /api/family-portal/medications`
- `GET /api/family-portal/occurrences`
- `GET /api/family-portal/comorbidities`

### 8.3 Super Admin / Organizacoes

- `GET /api/organizations`
- `GET /api/organizations/:id`
- `POST /api/organizations`
- `PUT /api/organizations/:id`
- `DELETE /api/organizations/:id`
- `GET /api/organizations/:id/users`
- `POST /api/organizations/:id/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`

### 8.4 Residentes e Prontuario

- `GET /api/residents`
- `GET /api/residents/:id`
- `POST /api/residents`
- `PUT /api/residents/:id`
- `DELETE /api/residents/:id`
- `GET /api/residents/:residentId/family`
- `POST /api/residents/:residentId/family`
- `PUT /api/family/:id`
- `DELETE /api/family/:id`
- `GET /api/residents/:residentId/comorbidities`
- `POST /api/residents/:residentId/comorbidities`
- `PUT /api/comorbidities/:id`
- `DELETE /api/comorbidities/:id`
- `GET /api/residents/:residentId/medical-records`
- `POST /api/residents/:residentId/medical-records`
- `PUT /api/medical-records/:id`
- `DELETE /api/medical-records/:id`

### 8.5 Medicacoes

- `GET /api/medications`
- `POST /api/medications`
- `PUT /api/medications/:id`
- `DELETE /api/medications/:id`
- `GET /api/medication-administrations`
- `POST /api/medication-administrations`

### 8.6 Equipe

- `GET /api/staff`
- `POST /api/staff`
- `PUT /api/staff/:id`
- `DELETE /api/staff/:id`

### 8.7 Ocorrencias

- `GET /api/occurrences`
- `POST /api/occurrences`
- `PUT /api/occurrences/:id`
- `DELETE /api/occurrences/:id`

### 8.8 Escalas

- `GET /api/shift-assignments`
- `POST /api/shift-assignments/generate-month`
- `POST /api/shift-assignments/:id/exclude-day`
- `POST /api/shift-assignments`
- `PUT /api/shift-assignments/:id`
- `DELETE /api/shift-assignments/:id`

### 8.9 Financeiro

- `GET /api/contracts`
- `GET /api/contracts/:id`
- `POST /api/contracts`
- `PUT /api/contracts/:id`
- `DELETE /api/contracts/:id`
- `GET /api/monthly-fees`
- `POST /api/monthly-fees`
- `PUT /api/monthly-fees/:id`
- `DELETE /api/monthly-fees/:id`

### 8.10 Configuracoes e Stats

- `GET /api/environment-settings`
- `PUT /api/environment-settings`
- `GET /api/stats`

## 9. Frontend (Rotas de Tela)

- `/login`
- `/` (dashboard)
- `/residents`
- `/prontuario`
- `/medications`
- `/staff`
- `/escalas`
- `/occurrences`
- `/financeiro`
- `/environment`
- `/admin` (somente super admin)
- `/portal`
- `/portal/home`

## 10. Configuracao de Ambiente e Variaveis

Arquivo `.env`:

- `DATABASE_URL` (obrigatorio)
- `SESSION_SECRET` (obrigatorio, forte em producao)
- `PORT` (opcional, default 5000)

## 11. Execucao Local

```bash
npm ci
npm run dev
```

## 12. Build e Producao

```bash
npm ci
npm run check
npm run build
npm run start
```

## 13. Operacao de Banco em Producao

### 13.1 Compatibilidade automatica no boot

Ao iniciar o servidor, `ensureDatabaseCompatibility()` aplica `ALTER TABLE IF NOT EXISTS` para colunas criticas, evitando quebra por schema antigo.

### 13.2 Cuidado com `db:push`

`npm run db:push` pode sugerir remover `user_sessions`.
Nao confirmar essa remocao em producao sem planejamento.

## 14. Troubleshooting Rapido

### 14.1 Erro "column ... does not exist"

Significa que o banco de producao esta atras do schema.

Acoes:
- fazer backup
- aplicar SQL de compatibilidade
- rebuild/restart da aplicacao

### 14.2 Erro de permissao (403)

Verificar:
- papel do usuario
- `roleRoutes` para visualizacao
- `roleEditRoutes` para edicao
- status da organizacao (`active/inactive/restricted`)

## 15. Arquivos-Chave para Manutencao

- `shared/schema.ts`: modelo de dados e tipos
- `shared/environment.ts`: papeis, permissoes e perfis de jornada
- `server/routes.ts`: regras de negocio e API
- `server/storage.ts`: acesso ao banco
- `server/db.ts`: compatibilidade de schema no startup
- `client/src/pages/*`: interfaces dos modulos
- `client/src/lib/permissions.ts`: regras de acesso no frontend

---

Documento gerado para servir como referencia funcional e tecnica do estado atual do sistema.
