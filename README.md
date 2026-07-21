# Orçamentos PatroTintas

App web para montar orçamentos rapidamente (bipagem de código de barras, leitura pela câmera, geração de PDF sem mostrar o custo).

## Rodar localmente

```bash
npm install
npm run dev
```

## Publicar (GitHub Pages)

O deploy é automático: todo push na branch `main` roda o workflow em
`.github/workflows/deploy.yml` e publica o site.

Na primeira vez, habilite em **Settings → Pages → Source → GitHub Actions**
no repositório do GitHub.

Se o nome do repositório for diferente de `orcamento-patrotintas`, ajuste o
campo `base` em `vite.config.js` para `/nome-do-repositorio/`.
