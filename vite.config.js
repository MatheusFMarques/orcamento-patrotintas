import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANTE: "base" precisa ser "/NOME-DO-REPOSITORIO/" (igual ao nome do repo no GitHub).
// Se você criar o repositório com outro nome, troque o valor abaixo antes do deploy.
export default defineConfig({
  plugins: [react()],
  base: "/orcamento-patrotintas/",
});
