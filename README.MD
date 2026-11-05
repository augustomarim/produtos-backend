# Catálogo de Produtos — Backend

API de estudo para cadastro e gerenciamento de produtos, com autenticação e upload de imagens.

## Tecnologias

- Node.js e Express.
- Prisma ORM.
- PostgreSQL hospedado no Neon.
- Cloudinary para armazenamento de imagens.
- Zod para validação.
- bcryptjs para hash de senhas.
- JWT para autenticação.

## Funcionalidades

- Cadastro e login de usuários.
- Access token com validade de 15 minutos.
- Refresh token com validade de 7 dias e rotação.
- Armazenamento apenas do hash do refresh token.
- Logout com revogação do refresh token.
- Criação, listagem, edição e exclusão de produtos.
- Ativação e inativação de produtos.
- Upload, substituição e remoção de fotos.
- Geração de URL de miniatura.

## API publicada

https://produtos-backend-klns.onrender.com

Verificação de disponibilidade:

```text
GET /health
```

Resposta esperada:

```json
{
  "status": "ok"
}
```

## Requisitos

- Node.js 24 LTS.
- npm.
- Banco PostgreSQL.
- Conta no Cloudinary.

## Instalação

Clone o repositório:

```bash
git clone https://github.com/augustomarim/produtos-backend.git
cd produtos-backend
```

Instale as dependências:

```bash
npm ci
```

## Variáveis de ambiente

Crie um arquivo `.env` na raiz e preencha:

```env
DATABASE_URL=
JWT_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
PORT=3000
```

- `DATABASE_URL`: endereço de conexão com o PostgreSQL.
- `JWT_SECRET`: chave aleatória usada para assinar os access tokens.
- `CLOUDINARY_CLOUD_NAME`: nome da conta no Cloudinary.
- `CLOUDINARY_API_KEY`: chave da API do Cloudinary.
- `CLOUDINARY_API_SECRET`: segredo da API do Cloudinary.
- `PORT`: porta do servidor local.

Nunca publique o arquivo `.env`, senhas, chaves ou tokens no GitHub.

## Banco de dados

Valide o schema:

```bash
npx prisma validate
```

Aplique as migrações existentes ao banco configurado:

```bash
npx prisma migrate deploy
```

Gere o Prisma Client:

```bash
npx prisma generate
```

Para criar uma nova migração durante o desenvolvimento:

```bash
npx prisma migrate dev --name nome_da_alteracao
```

Confira o destino de `DATABASE_URL` antes de executar migrações.
Use um banco separado para desenvolvimento.

## Executar localmente

Modo de desenvolvimento:

```bash
npm run dev
```

Modo normal:

```bash
npm start
```

Com `PORT=3000`, a API fica disponível em:

```text
http://localhost:3000
```

## Autenticação

### Cadastrar usuário

```text
POST /auth/register
```

Body JSON:

```json
{
  "nome": "Estudante",
  "email": "estudo@example.com",
  "senha": "senha-de-exemplo"
}
```

### Fazer login

```text
POST /auth/login
```

Body JSON:

```json
{
  "email": "estudo@example.com",
  "senha": "senha-de-exemplo"
}
```

A resposta contém:

- `token`: access token.
- `refreshToken`: token para renovar a sessão.
- `refreshTokenExpiresAt`: data de expiração.
- `usuario`: dados públicos do usuário.

### Renovar a sessão

```text
POST /auth/refresh
```

Body JSON:

```json
{
  "refreshToken": "SEU_REFRESH_TOKEN"
}
```

Uma renovação válida revoga o refresh token utilizado e retorna
um novo par de tokens. O token antigo não pode ser reutilizado.

### Encerrar a sessão

```text
POST /auth/logout
```

Body JSON:

```json
{
  "refreshToken": "SEU_REFRESH_TOKEN_ATUAL"
}
```

Retorna `204`, sem conteúdo.

O logout revoga o refresh token informado. O access token já
emitido continua válido até sua expiração.

## Rotas de produtos

Todas as rotas abaixo exigem o cabeçalho:

```text
Authorization: Bearer SEU_ACCESS_TOKEN
```

| Método | Rota | Descrição |
|---|---|---|
| GET | `/produtos` | Listar produtos |
| GET | `/produtos/:id` | Buscar um produto |
| POST | `/produtos` | Criar produto |
| PUT | `/produtos/:id` | Atualizar produto |
| PATCH | `/produtos/:id/status` | Alternar entre ativo e inativo |
| DELETE | `/produtos/:id/foto` | Remover a foto |
| DELETE | `/produtos/:id` | Excluir produto |

### Criar produto com foto

Envie o body como `multipart/form-data`:

| Campo | Tipo | Obrigatório |
|---|---|---|
| `codigo_produto` | Texto | Sim |
| `descricao_produto` | Texto | Sim |
| `foto_produto` | Arquivo | Não |

Não defina o `Content-Type` manualmente ao enviar com FormData.
A ferramenta ou biblioteca deve gerar o boundary multipart.

A foto é enviada como arquivo, não como URL. O backend faz o
upload ao Cloudinary e salva a URL retornada.

### Atualizar produto

Use `PUT /produtos/:id` com os campos que deseja alterar:

- `codigo_produto`.
- `descricao_produto`.
- `status`: `ativo` ou `inativo`.
- `foto_produto`: novo arquivo de imagem.

Sem um novo arquivo, a foto atual é mantida.

### Imagens

- Formatos aceitos: JPG, PNG e WebP.
- Limite do backend: 5 MB.
- As respostas incluem `foto_produto` e `foto_miniatura`.
- A miniatura usa transformação do Cloudinary para 150 × 150 pixels.
- A remoção da foto mantém o produto cadastrado.

O frontend web pode adotar um limite menor para respeitar
as restrições de sua hospedagem.

## Respostas comuns

| Status | Significado |
|---|---|
| 200 | Operação concluída |
| 201 | Registro criado |
| 204 | Operação concluída sem conteúdo |
| 400 | Dados ou arquivo inválidos |
| 401 | Autenticação ausente, inválida ou expirada |
| 404 | Registro ou rota não encontrados |
| 409 | Email ou código de produto duplicado |
| 500 | Erro interno |

## Testes automatizados

Com Node.js 24 LTS:

```bash
npm test
```

Os testes executam as rotas reais de autenticação via HTTP local,
com banco simulado. Cobrem login, validade dos tokens, rotação,
reutilização, expiração, logout, erros e rollback simulado.
Não substituem testes de integração no PostgreSQL/Neon. A concorrência
é simulada com transações serializadas; bloqueios reais do PostgreSQL
não são verificados por essa suíte. Nenhum dado é gravado no Neon.

## Validação manual

Use Postman ou Thunder Client para testar:

1. Cadastro e login.
2. Acesso aos produtos com e sem access token.
3. Renovação da sessão e rejeição do refresh token antigo.
4. Logout e rejeição de nova renovação.
5. CRUD de produtos.
6. Validação de campos e códigos duplicados.
7. Ativação e inativação.
8. Upload, substituição e remoção de fotos.

## Publicação no Render

Configure as variáveis de ambiente no painel do serviço.

Comandos para uma instalação nova:

```bash
npm ci
npx prisma migrate deploy
```

Comando de inicialização:

```bash
npm start
```

O servidor utiliza a variável `PORT` fornecida pelo Render.

## Projeto relacionado

Frontend web:
https://github.com/augustomarim/produtos-web

O web e o aplicativo mobile utilizam a mesma API.

## Histórico e ordenação dos produtos

A API retorna `createdAt` (criação) e `updatedAt` (última alteração).
A listagem mantém ativos antes de inativos. Dentro de cada grupo, prioriza
a última alteração em ordem decrescente, com desempate por ID decrescente. Edição, mudança de status e alterações de foto atualizam
`updatedAt` pelo Prisma.

A migração `20261103210000_product_dates` acrescenta as colunas sem apagar
produtos. As datas de registros anteriores ficam nulas, pois não existia
histórico para recuperar. Produtos novos recebem as duas datas; uma alteração
em um produto antigo passa a registrar sua data de atualização.

### Aplicar esta atualização no Render

Para a migração de produtos por usuário, siga também a seção **Produtos privados
por conta — migração obrigatória**, que exige interromper o backend antigo
durante a troca e descreve a limpeza autorizada dos dados sem autoria.

Antes de integrar a branch, configure o Build Command do serviço como:

```bash
npm ci && npx prisma migrate deploy
```

Mantenha o Start Command como `npm start`. A migração deve ser aplicada
antes de iniciar o backend atualizado. Não use `prisma migrate reset`.
Publique o backend antes do frontend que exibe essas datas.

Os testes de migração usam PostgreSQL embarcado (PGlite) somente como
ferramenta de desenvolvimento. Ele não substitui o Neon nem é usado pela API.


## Ações em lote (até 100 produtos)

As duas rotas exigem `Authorization: Bearer SEU_ACCESS_TOKEN` e JSON.
IDs devem ser inteiros positivos de até 2147483647. A lista deve ter entre
1 e 100 posições; IDs repetidos são deduplicados depois da validação.
IDs que não existem são ignorados e informados pela diferença de contagens.

### Definir status

```text
PATCH /produtos/status
```

```json
{ "ids": [3, 7, 12], "status": "inativo" }
```

O status é explícito: todos os encontrados ficam `inativo` (ou `ativo`),
sem regravar quem já estava nesse estado. Uma transação bloqueia as linhas e
atualiza somente os necessários com `updateManyAndReturn`. Retorna
`{ solicitados, afetados, jaNoStatus, naoEncontrados, produtos }`.
`afetados` conta alterações reais; `jaNoStatus` mantém a data anterior.
Os produtos incluem `updatedAt` e `foto_miniatura`, permitindo atualizar a
lista sem outra consulta. Uma repetição não inverte o status.

### Excluir seleção

```text
DELETE /produtos
```

```json
{ "ids": [3, 7, 12] }
```

Retorna `{ solicitados, afetados, idsExcluidos, fotosNaoRemovidas }`.
Uma transação bloqueia as linhas selecionadas, captura suas fotos e executa
`deleteMany`. Uma falha de banco desfaz a exclusão, sem apagar fotos.
As fotos são removidas após o commit, em grupos de até cinco requisições.
Banco e Cloudinary não compartilham transação: falhas nas fotos não desfazem
uma exclusão já confirmada e são sinalizadas por `fotosNaoRemovidas`.
O cliente deve informar esse resultado, sem repetir a exclusão automaticamente.

### Testes do lote

`npm ci` gera o Prisma Client; `npm test` executa as rotas reais com esse
cliente e PostgreSQL embarcado via PGlite/socket, sem acessar o Neon.
Cloudinary é simulado para testar sucesso/falha da limpeza. A suíte verifica
`updatedAt`, autenticação, deduplicação, IDs ausentes, limite de 100 e rollback.
O banco de testes usa uma conexão local e não substitui testes de carga ou
concorrência em um PostgreSQL de produção.

Esta funcionalidade não acrescenta migrações. Integre e publique primeiro
o backend e, depois, o web com checkboxes.

## Consulta paginada

`GET /produtos?pagina=1&limite=25&busca=cafe&status=todos&ordem=atualizados`
retorna `{ produtos, total, pagina, paginas, limite, resumo }`. `total` é a
quantidade filtrada; `resumo` contém total, ativos e inativos do catálogo.
Busca apenas pela descrição, sem distinguir maiúsculas e acentos portugueses.
`status`: todos/ativo/inativo; `ordem`: atualizados/criados/codigo. Ativos
sempre vêm antes dos inativos. O limite aceito é de 1 a 100; página inexistente
é ajustada à última. Contagens e página usam a mesma transação RepeatableRead.
Sem parâmetros de consulta reconhecidos, a resposta permanece um array para
compatibilidade. Nenhuma migração adicional é necessária.

## Produtos privados por conta — migração obrigatória

`Produto.usuarioId` é obrigatório e referencia `Usuario`. O dono vem
exclusivamente do JWT validado; nunca do JSON, formulário ou query string.
Todas as consultas (incluindo contagens e o array legado), alterações,
exclusões, fotos e ações em lote incluem esse dono. ID inexistente e ID de
outro usuário retornam o mesmo 404. Nos lotes, IDs alheios são tratados como
não encontrados e não têm dados, datas ou fotos modificados/revelados.
O código agora é único por usuário: duas contas podem usar o mesmo código.
Não existe rota para transferir produtos entre contas.

### Efeito sobre os dados existentes

A migração `20261105180000_produtos_por_usuario` adiciona a autoria, remove
produtos sem dono e impõe NOT NULL, chave estrangeira e unicidade composta.
Como o schema anterior não registrava autoria, **todos os produtos anteriores
à migração serão apagados**. Essa limpeza foi autorizada pelo responsável
pelo projeto; não há tentativa de atribuir o catálogo compartilhado a alguém.
Usuários, senhas e refresh tokens são preservados. Novos produtos já nascem
com dono. A chave estrangeira impede novos produtos órfãos e bloqueia excluir
um usuário que ainda possua produtos.

A limpeza é de registros no PostgreSQL. Arquivos antigos no Cloudinary não
são apagados por essa migração SQL. As imagens continuam com URLs públicas;
a autorização protege consulta e modificação pela API, não uma URL pública
já conhecida.

### Implantação

Faça a troca em uma janela de manutenção: interrompa o acesso ao backend
antigo antes de aplicar a migração, mantendo-o indisponível até iniciar a
nova versão. Não mantenha instâncias antigas e novas atendendo em paralelo:
o código antigo não conhece o filtro de autoria.

Na versão nova, com as variáveis do Render configuradas:

```bash
npm ci
npx prisma migrate deploy
npm start
```

No Render, mantenha o Start Command como `npm start`; use o comando de
migração na etapa de implantação, respeitando a interrupção do serviço
anterior. O comando precisa usar a DATABASE_URL do Neon já configurada no
serviço. Não execute `migrate reset`, não altere migrações antigas e não
volte ao backend antigo após aplicar esta migração. Depois do backend
atualizado, integre e publique o web com limpeza de sessão por conta.

Os testes locais usam Prisma real/PGlite e duas contas para verificar códigos
iguais, contagens, busca, todos os endpoints por ID, envio/substituição/remoção
de fotos, lotes mistos e tentativas de forjar autoria. Testam também a migração
com dados antigos e a preservação de usuários/sessões; não alteram o Neon.
