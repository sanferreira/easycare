# Documentação Completa do Sistema EasyCare

## 1. Visão Geral

O EasyCare é um sistema web para gestão de ILPI (Instituição de Longa Permanência para Idosos), com arquitetura multi-tenant.

Cada organização possui seus próprios dados de:
- residentes
- equipe
- prontuário
- medicações
- escalas
- ocorrências
- financeiro

Existe também:
- painel de superadmin (cross-organização)
- portal da família

## 2. Arquitetura Técnica

### 2.1 Stack

- Frontend: React 18 + TypeScript + Vite + Wouter + TanStack Query + Tailwind/shadcn
- Backend: Node.js + Express + TypeScript
- Banco: PostgreSQL + Drizzle ORM
- Sessão: `express-session` + `connect-pg-simple`
- Segurança de senha: PBKDF2-SHA256 com rehash automático

### 2.2 Estrutura de pastas

- `client/`: interface web
- `server/`: API, autenticação, regras de negócio
- `shared/`: contratos compartilhados (schema, rotas, regras de ambiente)
- `script/build.ts`: build de frontend + backend para produção

## 3. Multi-Tenancy e Autenticação

### 3.1 Modelo de isolamento

- Usuário de organização sempre trabalha dentro de `organizationId`
- Superadmin é global e gerencia todas as organizações
- Portal da família tem sessão separada (`session.familyMember`)

### 3.2 Login

- Rota principal: `POST /api/auth/login`
- Login por organização usando `organizationCnpj` + `username` + `password`
- Superadmin faz login sem organização
- Usuários inativos não entram
- Organizações inativas/restritas bloqueiam acesso

### 3.3 Sessão

- Cookie de sessão: `easycare.sid`
- Store em tabela `user_sessions`

## 4. Permissões (RBAC)

O sistema usa dois níveis por módulo:
- `view` (visualização)
- `edit` (edição)

### 4.1 Conceitos

- `roleRoutes`: módulos que o papel pode ver
- `roleEditRoutes`: módulos que o papel pode editar

### 4.2 Regra forte de segurança

No backend:
- requisições `GET/HEAD/OPTIONS` exigem permissão de `view`
- requisições `POST/PUT/PATCH/DELETE` exigem permissão de `edit`

Ou seja: quem tem só visualização não salva/edita nada em nenhum módulo.

### 4.3 Papéis padrão

Papéis de sistema padrão:
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

Cargos de equipe padrão (select da tela Equipe):
- `cuidador`
- `enfermeiro`
- `tecnico_enfermagem`
- `medico`
- `fisioterapeuta`
- `nutricionista`
- `recepcionista`
- `administrativo`

## 5. Módulos Funcionais

### 5.1 Dashboard

- KPIs principais da organização
- ocupação
- medicações ativas
- ocorrências pendentes
- dados financeiros

### 5.2 Residentes

- cadastro completo (dados pessoais, saúde e contato)
- status do residente
- foto do residente
- abertura de detalhes por linha

### 5.3 Prontuário

- registros clínicos (`medical_records`)
- comorbidades/diagnósticos (`comorbidities`)
- familiares (`family_members`)

### 5.4 Medicações

- cadastro de medicamento por residente
- registro de administração (`medication_administrations`)
- rastreabilidade de quem administrou
- para cuidador: só pode registrar como ele mesmo

### 5.5 Equipe

- cadastro completo de colaborador (CLT/PJ, docs, contato, foto)
- jornada recorrente por:
  - dia da semana
  - dias pares/ímpares
  - datas bloqueadas
- acesso ao portal por colaborador:
  - `portalAccess`
  - `portalUsername`
  - senha inicial/alteração
- sincronização com tabela `users` para login real

### 5.6 Escalas

- criação manual de plantão
- geração mensal automática
- validações:
  - sem sobreposição
  - respeita jornada do colaborador
  - respeita regras do perfil (ex.: 12x36)
  - respeita descanso mínimo entre plantões
- dispensar dia específico (bloqueia data e remove plantão daquele dia)

### 5.7 Ocorrências

- abertura e acompanhamento por gravidade e status
- resolução e data de resolução

### 5.8 Financeiro

- contratos por residente
- mensalidades por contrato/residente
- status de pagamento e indicadores

### 5.9 Configuração de Ambiente

- cadastro de papéis/cargos
- matriz de permissão por módulo (ver/editar)
- perfis de jornada e regras (duração, descanso, tipos permitidos)

### 5.10 Superadmin

- CRUD de organizações
- status da organização: `active`, `inactive`, `restricted`
- CRUD de usuários por organização

### 5.11 Portal da Família

- login de familiar
- visão de residente, registros compartilhados, medicações e ocorrências filtradas

## 6. Regras de Negócio Relevantes

## 6.1 Status de organização

- `active`: acesso normal
- `inactive`: acesso bloqueado
- `restricted`: acesso bloqueado com mensagem de restrição

## 6.2 Cuidador só atua em si mesmo

Em ações sensíveis (escala e administração de medicamento):
- se papel for `cuidador`, o sistema obriga vínculo ao próprio colaborador
- não pode selecionar outro profissional

## 6.3 Geração mensal de escalas

- usa agenda recorrente configurada no colaborador
- pares/ímpares têm prioridade sobre dia da semana
- ignora datas bloqueadas
- cria notas internas com prefixo `[AUTO-MONTH:YYYY-MM]`
- pode limpar escalas geradas automaticamente antes de gerar novamente

## 6.4 Perfil de jornada com regra (ex.: 12x36)

Permite definir:
- horas exatas do plantão
- descanso mínimo entre plantões
- tipos de plantão permitidos (`12h_manha`, `12h_noite`, `24h`, `avulso`)

## 6.5 Acesso ao portal para colaborador

Ao ativar/desativar no cadastro de equipe:
- cria/atualiza/desativa usuário em `users`
- vincula via `portalUserId` + `portalUsername`

## 7. Modelo de Dados (Resumo)

Tabelas principais:

- `organizations`: tenant, dados da instituição, status, configurações do ambiente
- `users`: login de sistema por organização e superadmin
- `residents`: residentes
- `family_members`: familiares e acesso ao portal da família
- `staff`: colaboradores e jornada
- `shift_assignments`: escalas
- `medications`: medicamentos prescritos
- `medication_administrations`: administrações realizadas
- `medical_records`: registros de prontuário
- `comorbidities`: diagnósticos/comorbidades
- `occurrences`: ocorrências operacionais
- `contracts`: contratos financeiros
- `monthly_fees`: mensalidades
- `user_sessions`: sessões web

## 8. API (Resumo por Domínio)

### 8.1 Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 8.2 Portal da Família

- `POST /api/family-portal/login`
- `POST /api/family-portal/logout`
- `GET /api/family-portal/me`
- `GET /api/family-portal/resident`
- `GET /api/family-portal/medical-records`
- `GET /api/family-portal/medications`
- `GET /api/family-portal/occurrences`
- `GET /api/family-portal/comorbidities`

### 8.3 Superadmin / Organizações

- `GET /api/organizations`
- `GET /api/organizations/:id`
- `POST /api/organizations`
- `PUT /api/organizations/:id`
- `DELETE /api/organizations/:id`
- `GET /api/organizations/:id/users`
- `POST /api/organizations/:id/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`

### 8.4 Residentes e Prontuário

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

### 8.5 Medicações

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

### 8.7 Ocorrências

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

### 8.10 Configurações e Stats

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
- `/admin` (somente superadmin)
- `/portal`
- `/portal/home`

## 10. Configuração de Ambiente e Variáveis

Arquivo `.env`:

- `DATABASE_URL` (obrigatório)
- `SESSION_SECRET` (obrigatório, forte em produção)
- `PORT` (opcional, padrão 5000)

## 11. Execução Local

```bash
npm ci
npm run dev
```

## 12. Build e Produção

```bash
npm ci
npm run check
npm run build
npm run start
```

## 13. Operação de Banco em Produção

### 13.1 Compatibilidade automática no boot

Ao iniciar o servidor, `ensureDatabaseCompatibility()` aplica `ALTER TABLE IF NOT EXISTS` para colunas críticas, evitando quebra por schema antigo.

### 13.2 Cuidado com `db:push`

`npm run db:push` pode sugerir remover `user_sessions`.
Não confirme essa remoção em produção sem planejamento.

## 14. Troubleshooting Rápido

### 14.1 Erro "column ... does not exist"

Significa que o banco de produção está atrás do schema.

Ações:
- fazer backup
- aplicar SQL de compatibilidade
- rebuild/restart da aplicação

### 14.2 Erro de permissão (403)

Verificar:
- papel do usuário
- `roleRoutes` para visualização
- `roleEditRoutes` para edição
- status da organização (`active/inactive/restricted`)

## 15. Arquivos-chave para Manutenção

- `shared/schema.ts`: modelo de dados e tipos
- `shared/environment.ts`: papéis, permissões e perfis de jornada
- `server/routes.ts`: regras de negócio e API
- `server/storage.ts`: acesso ao banco
- `server/db.ts`: compatibilidade de schema no startup
- `client/src/pages/*`: interfaces dos módulos
- `client/src/lib/permissions.ts`: regras de acesso no frontend

---

Documento gerado para servir como referência funcional e técnica do estado atual do sistema.
