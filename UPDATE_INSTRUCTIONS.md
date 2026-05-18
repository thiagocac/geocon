# geoCon — Update V75 → V77 (hotfix bundle)

Este ZIP contém **apenas os arquivos alterados ou novos** entre V75 e V77.
Estrutura espelha a do repositório — basta extrair e substituir/adicionar
sobre o seu working tree.

## Contexto

V76 corrigiu a **tela branca pós-deploy** (Service Worker estagnado em
`geocon-v62` + falta de error boundary + falta de loader inline). V77
corrigiu o erro real exposto pela boundary: o hook `useRealtimeAlerts` era
consumido por dois componentes do layout simultaneamente, ambos criando um
`supabase.channel()` com o mesmo nome, e o cliente Supabase JS rejeitava o
segundo `.on('postgres_changes', ...)`.

Ambas as correções são **infra/runtime puras**: zero migrations, zero
mudança de API, zero feature nova. Endereçam bugs em produção.

## Arquivos neste pacote (9)

### Modificados (6)

| Arquivo | Por quê |
|---|---|
| `README.md` | Adiciona seções V76 e V77 acima de V75 |
| `index.html` | Boot loader CSS inline + handler global de erro com botões "Recarregar" e "Limpar cache e recarregar" |
| `netlify.toml` | `Cache-Control: no-cache, must-revalidate` para `/config.js` e `/sw.js` |
| `public/sw.js` | `CACHE_NAME` versionado (`geocon-v76`); lista `NEVER_CACHE` faz bypass de `/config.js`, `/sw.js`, `/manifest.webmanifest`, `/_redirects`; activate purga todos os caches antigos |
| `src/main.tsx` | Envolve `<App />` em `BootErrorBoundary`; remove `#geocon-boot` via `queueMicrotask` após primeiro render |
| `src/lib/api.ts` | `subscribeToRealtimeAlerts` substituído por singleton multiplexador (1 channel WebSocket por tenant, N callbacks locais) |

### Novos (3)

| Arquivo | Por quê |
|---|---|
| `src/components/BootErrorBoundary.tsx` | Error boundary React que captura erros do boot e renderiza tela de erro com stack + ações de recuperação |
| `docs/release-v76.md` | Notas de release V76 |
| `docs/release-v77.md` | Notas de release V77 |

## Como aplicar

### Opção A — extrair direto sobre o working tree

```bash
cd seu-repo-geocon
unzip -o /caminho/GeoCon_Update_V75_to_V77.zip
# Conferir as mudanças
git status
git diff
# Build local pra confirmar
npm run typecheck && npm run build
# Commit + push
git add -A
git commit -m "V76+V77: hotfix tela branca pós-deploy + fix realtime channel"
git push
```

### Opção B — aplicar arquivo por arquivo no GitHub web

1. No repositório, navegue até cada caminho da tabela acima
2. Substitua o conteúdo (ou crie o arquivo, no caso dos novos)
3. Commit pela interface web

## Verificação pós-deploy

1. Abrir a app em produção. O **boot loader** ("Carregando geoCon" com
   spinner) deve aparecer instantaneamente, antes do conteúdo
2. DevTools → Application → Service Workers: o SW deve estar como
   `geocon-v76` (não mais `geocon-v62`)
3. DevTools → Application → Cache Storage: apenas a chave `geocon-v76`,
   sem `geocon-v62` (limpo no activate)
4. DevTools → Network → WS: apenas **uma** conexão WebSocket para o
   Supabase Realtime (V77 deduplicou)
5. DevTools → Console: ausência da mensagem
   "cannot add `postgres_changes` callbacks ... after `subscribe()`"

## Para usuários que ainda virem tela branca depois do deploy

O SW V62 antigo pode levar 1 reload extra para ser substituído pelo V76.
Caso persista, o usuário pode:

- Fazer hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`), **ou**
- Se aparecer a tela de erro nova, clicar em **"Limpar cache e recarregar"**

Esse botão desregistra o SW antigo, apaga todos os caches do origin e
recarrega — resolução em um clique sem precisar abrir DevTools.

## Detalhes técnicos completos

Veja `docs/release-v76.md` e `docs/release-v77.md`.

## Impacto de bundle

```
V75 main bundle (gzipped):  109.67 KB
V76 main bundle (gzipped):  110.67 KB   (+1.00 KB → BootErrorBoundary)
V77 main bundle (gzipped):  110.78 KB   (+0.11 KB → singleton multiplexer)
```

Alvo de 150 KB → margem restante: 39.22 KB.
