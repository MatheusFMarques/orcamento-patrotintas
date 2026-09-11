import { useState, useRef, useEffect, useMemo } from "react";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, firebaseConfigurado } from "./firebase.js";

// ============================================================
// ORÇAMENTOS PATROTINTAS — v2
// • Orçamento sempre aberto (tela única)
// • Cliente padrão "Consumidor" (editável com um toque)
// • Custo SEMPRE visível na tela — NUNCA no PDF
// • "Enviar PDF" gera um arquivo .pdf de verdade (compartilhar/baixar)
// • Código de barras de cada linha = "quantidade*sku" (ex: 5*7899389000175)
// ============================================================

const LARANJA = "#EE7203";
const LARANJA_ESCURO = "#C85E00";
const AMARELO = "#FFC20E";
const CINZA_FUNDO = "#F5F3F0";

// Produtos de exemplo — usados só até a loja importar o arquivo real de preços
const PRODUTOS_PADRAO = [
  { codigo: "000123", eans: ["7891234500011"], familia: "A", unidade: "UN", descricao: "FUTURA SUPER AMARELO 18L", preco: 300.0, custo: 198.5 },
  { codigo: "000124", eans: ["7891234500028"], familia: "A", unidade: "UN", descricao: "MASSA PVA FUTURA GL", preco: 30.0, custo: 17.2 },
  { codigo: "000125", eans: ["7891234500035"], familia: "A", unidade: "UN", descricao: "SUVINIL TOQUE DE SEDA BRANCO 18L", preco: 489.9, custo: 342.0 },
  { codigo: "000201", eans: ["7891234500110"], familia: "DP 1", unidade: "UN", descricao: "FUTURA ACRILICO PREMIUM BRANCO 3,6L", preco: 89.9, custo: 58.4 },
  { codigo: "000310", eans: ["7891234500219"], familia: "F 1", unidade: "UN", descricao: "MASSA CORRIDA CRISTAIS AMAIS 25KG", preco: 64.9, custo: 41.0 },
  { codigo: "000412", eans: ["7891234500318"], familia: "D1", unidade: "PC", descricao: "ROLO DE LA 23CM ATLAS", preco: 24.9, custo: 14.3 },
  { codigo: "000413", eans: ["7891234500325"], familia: "D1", unidade: "PC", descricao: "TRINCHA 2.1/2 TIGRE", preco: 12.9, custo: 6.8 },
  { codigo: "000414", eans: ["7891234500332"], familia: "D1", unidade: "PC", descricao: "FITA CREPE 48MM X 50M 3M", preco: 18.5, custo: 10.9 },
  { codigo: "000520", eans: ["7891234500417"], familia: "G", unidade: "UN", descricao: "SELADOR ACRILICO FARBEN 18L", preco: 149.9, custo: 96.0 },
];

const CHAVE_PRODUTOS = "patrotintas_produtos";

const normalizarTexto = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Lê o arquivo (.xls / .xlsx / .csv) escolhido pela loja e converte pro formato
// do app. Colunas esperadas: Codigo, Barras, Família, Descrição do produto, Custo, Preço Venda.
async function lerArquivoProdutos(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const planilha = XLSX.read(buffer, { type: "array" });
  const aba = planilha.Sheets[planilha.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { defval: "" });

  return linhas
    .map((linha) => {
      const campos = {};
      Object.keys(linha).forEach((chave) => {
        campos[normalizarTexto(chave)] = linha[chave];
      });
      const codigo = String(campos["codigo"] ?? "").trim();
      const barras = String(campos["barras"] ?? "").trim();
      const descricao = String(campos["descricao do produto"] ?? campos["descricao"] ?? "").trim();
      if (!codigo || !descricao) return null;
      return {
        codigo,
        eans: barras ? [barras] : [],
        familia: String(campos["familia"] ?? "").trim(),
        unidade: String(campos["unidade"] ?? "UN").trim() || "UN",
        descricao,
        preco: Number(campos["preco venda"] ?? campos["preco"]) || 0,
        custo: Number(campos["custo"]) || 0,
      };
    })
    .filter(Boolean);
}

// Sincronização em nuvem (Firestore) — todo aparelho lê daqui, então quando a
// loja importa um arquivo novo, todo mundo passa a ver a lista atualizada
// (na próxima vez que abrir/recarregar o site).
const DOC_PRODUTOS = () => doc(db, "patrotintas", "produtos");

async function carregarProdutosNuvem() {
  if (!firebaseConfigurado) return null;
  try {
    const snap = await getDoc(DOC_PRODUTOS());
    if (!snap.exists()) return null;
    const json = snap.data().json;
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

async function salvarProdutosNuvem(produtos) {
  if (!firebaseConfigurado) return false;
  try {
    await setDoc(DOC_PRODUTOS(), { json: JSON.stringify(produtos), atualizadoEm: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

// Converte para número aceitando vírgula (pt-BR) ou ponto, e texto vazio.
// Ex.: "52,36" -> 52.36, "" -> 0, 300 -> 300
const num = (v) => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

const fmt = (v) =>
  num(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Trava de acesso simples (senha única compartilhada) — guarda só o hash,
// nunca a senha em texto puro. Válida para uso interno da loja; não é
// segurança de nível bancário, já que o site é 100% estático (sem servidor).
const SENHA_HASH = "9c9e12618b2377ed17319fd78d705cf7cbae5caca23af103dc664cdc263e5305";
const CHAVE_AUTH = "patrotintas_auth";

async function sha256Hex(texto) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Gera a imagem (PNG) de um código de barras CODE128 fora da tela, para colar no PDF.
// Valor codificado = "quantidade*sku" (ex: "5*7899389000175") — é assim que o
// sistema de conferência/estoque lê a quantidade certa em uma única bipagem.
function gerarBarcodeDataURL(valor) {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, valor, {
    format: "CODE128",
    width: 2,
    height: 45,
    fontSize: 13,
    margin: 6,
    displayValue: true,
  });
  return canvas.toDataURL("image/png");
}

export default function OrcamentoApp() {
  const [autenticado, setAutenticado] = useState(() => localStorage.getItem(CHAVE_AUTH) === "1");
  const [senhaInput, setSenhaInput] = useState("");
  const [erroSenha, setErroSenha] = useState(false);
  const [verificando, setVerificando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setVerificando(true);
    const hash = await sha256Hex(senhaInput);
    setVerificando(false);
    if (hash === SENHA_HASH) {
      localStorage.setItem(CHAVE_AUTH, "1");
      setAutenticado(true);
      setErroSenha(false);
      setSenhaInput("");
    } else {
      setErroSenha(true);
    }
  };

  const sair = () => {
    localStorage.removeItem(CHAVE_AUTH);
    setAutenticado(false);
  };

  const [produtos, setProdutos] = useState(() => {
    try {
      const salvos = localStorage.getItem(CHAVE_PRODUTOS);
      return salvos ? JSON.parse(salvos) : PRODUTOS_PADRAO;
    } catch {
      return PRODUTOS_PADRAO;
    }
  });
  const [painelProdutosAberto, setPainelProdutosAberto] = useState(false);
  const [importando, setImportando] = useState(false);
  const arquivoRef = useRef(null);

  // Ao abrir o app, busca a lista mais recente da nuvem (o que outro vendedor
  // importou fica valendo pra todo mundo). Se não der (sem internet, Firebase
  // ainda não configurado…), continua usando a cópia salva neste aparelho.
  useEffect(() => {
    carregarProdutosNuvem().then((produtosNuvem) => {
      if (produtosNuvem && produtosNuvem.length > 0) {
        setProdutos(produtosNuvem);
        localStorage.setItem(CHAVE_PRODUTOS, JSON.stringify(produtosNuvem));
      }
    });
  }, []);

  const importarArquivo = async (file) => {
    setImportando(true);
    try {
      const novosProdutos = await lerArquivoProdutos(file);
      if (novosProdutos.length === 0) {
        mostrarAviso("Não encontrei produtos válidos nesse arquivo");
        return;
      }
      setProdutos(novosProdutos);
      localStorage.setItem(CHAVE_PRODUTOS, JSON.stringify(novosProdutos));
      const sincronizou = await salvarProdutosNuvem(novosProdutos);
      mostrarAviso(
        sincronizou
          ? `${novosProdutos.length} produtos importados e sincronizados para todos`
          : `${novosProdutos.length} produtos importados (só neste aparelho — nuvem indisponível)`,
        "ok"
      );
      setPainelProdutosAberto(false);
    } catch {
      mostrarAviso("Não consegui ler esse arquivo");
    } finally {
      setImportando(false);
    }
  };

  const excluirProdutos = async () => {
    setProdutos([]);
    localStorage.removeItem(CHAVE_PRODUTOS);
    await salvarProdutosNuvem([]);
    mostrarAviso("Lista de produtos apagada para todos", "ok");
  };

  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState([]); // {produto, qtd, preco}
  const [cliente, setCliente] = useState("Consumidor");
  const [observacao, setObservacao] = useState("");
  const [desconto, setDesconto] = useState("");
  const [aviso, setAviso] = useState(null);
  const [cameraAberta, setCameraAberta] = useState(false);
  const buscaRef = useRef(null);
  const qtdRefs = useRef({});
  const videoRef = useRef(null);

  useEffect(() => {
    buscaRef.current?.focus();
  }, []);

  // Leitura de código de barras pela câmera (igual ao app de contagem)
  useEffect(() => {
    if (!cameraAberta) return;
    let stream;
    let ativo = true;
    let timer;
    const iniciar = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!("BarcodeDetector" in window)) {
          mostrarAviso("Este navegador não lê códigos pela câmera (use o Chrome no celular)");
          return;
        }
        const detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "itf", "upc_a"],
        });
        const ler = async () => {
          if (!ativo || !videoRef.current) return;
          try {
            const codigos = await detector.detect(videoRef.current);
            if (codigos.length > 0) {
              const valor = codigos[0].rawValue;
              const alvo =
                produtos.find((p) => p.eans.includes(valor)) ||
                produtos.find((p) => p.codigo === valor);
              if (alvo) {
                adicionar(alvo);
                setCameraAberta(false);
                return;
              }
              mostrarAviso("Código não encontrado: " + valor);
            }
          } catch {}
          timer = setTimeout(ler, 300);
        };
        ler();
      } catch {
        mostrarAviso("Não foi possível acessar a câmera");
        setCameraAberta(false);
      }
    };
    iniciar();
    return () => {
      ativo = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraAberta, produtos]);

  const resultados = useMemo(() => {
    // Busca por palavras soltas, em qualquer ordem: "futura 18" acha "FUTURA SUPER AMARELO 18L"
    const termos = busca.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (termos.length === 0) return [];
    return produtos.filter((p) => {
      const alvo = `${p.descricao} ${p.codigo} ${p.eans.join(" ")}`.toUpperCase();
      return termos.every((t) => alvo.includes(t));
    }).slice(0, 8);
  }, [busca, produtos]);

  const mostrarAviso = (msg, tipo = "erro") => {
    setAviso({ msg, tipo });
    setTimeout(() => setAviso(null), 2200);
  };

  const adicionar = (produto) => {
    setItens((prev) => {
      const ix = prev.findIndex((i) => i.produto.codigo === produto.codigo);
      if (ix >= 0) {
        const novo = [...prev];
        novo[ix] = { ...novo[ix], qtd: num(novo[ix].qtd) + 1 };
        setTimeout(() => qtdRefs.current[produto.codigo]?.select(), 50);
        return novo;
      }
      setTimeout(() => qtdRefs.current[produto.codigo]?.select(), 50);
      return [...prev, { produto, qtd: 1, preco: produto.preco, obs: "" }];
    });
    setBusca("");
  };

  // Enter = bipagem do leitor físico
  const bipar = (e) => {
    if (e.key !== "Enter") return;
    const t = busca.trim();
    if (!t) return;
    const alvo =
      produtos.find((p) => p.eans.includes(t)) ||
      produtos.find((p) => p.codigo === t);
    if (alvo) adicionar(alvo);
    else if (resultados.length === 1) adicionar(resultados[0]);
    else if (resultados.length === 0) {
      mostrarAviso("Código não encontrado no cadastro");
      setBusca("");
    }
  };

  // Guarda o texto exatamente como digitado (aceitando vírgula e campo vazio);
  // a conversão para número acontece só na hora de calcular, via num().
  const alterar = (codigo, campo, valor) => {
    const limpo = String(valor).replace(/[^\d.,]/g, "");
    setItens((prev) =>
      prev.map((i) =>
        i.produto.codigo === codigo ? { ...i, [campo]: limpo } : i
      )
    );
  };

  const alterarObs = (codigo, valor) =>
    setItens((prev) =>
      prev.map((i) =>
        i.produto.codigo === codigo ? { ...i, obs: valor } : i
      )
    );

  const remover = (codigo) =>
    setItens((prev) => prev.filter((i) => i.produto.codigo !== codigo));

  const subtotal = itens.reduce((s, i) => s + num(i.qtd) * num(i.preco), 0);
  const total = Math.max(0, subtotal - num(desconto));
  const custoTotal = itens.reduce((s, i) => s + num(i.qtd) * i.produto.custo, 0);
  const numOrc = useMemo(
    () =>
      "ORC-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      String(Math.floor(Math.random() * 900) + 100),
    []
  );
  const agora = new Date();
  const hoje = agora.toLocaleDateString("pt-BR");
  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const itensValidos = itens.filter((i) => num(i.qtd) > 0);

  // Gera o PDF de verdade (arquivo, não impressão) e tenta abrir o compartilhamento
  // do celular (pra já anexar no WhatsApp); se não der, baixa o arquivo.
  const enviarPDF = async () => {
    if (itensValidos.length === 0) {
      mostrarAviso("Adicione itens antes de gerar o PDF");
      return;
    }

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = 210;
    const marginX = 12;
    const rightX = pageWidth - marginX;
    const colQtd = 60;
    const colUnid = 78;
    const colDesc = 90;
    const colValor = 165;
    let pagina = 1;
    let y = 16;

    const linha = (yy) => {
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.line(marginX, yy, rightX, yy);
    };

    const cabecalho = () => {
      doc.setFillColor(238, 114, 3);
      doc.roundedRect(marginX, y - 5, 38, 9, 1.5, 1.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("PatroTintas", marginX + 19, y, { align: "center" });

      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(
        ["NÃO É DOCUMENTO FISCAL - NÃO É VALIDO COMO RECIBO E COMO", "GARANTIA DE MERCADORIA - NÃO COMPROVA PAGAMENTO"],
        pageWidth / 2,
        y - 4,
        { align: "center" }
      );
      doc.setFont("helvetica", "normal");
      doc.text(`Pág: ${pagina}`, rightX, y - 4, { align: "right" });

      y += 8;
      linha(y);
      y += 5;

      doc.setFontSize(10);
      doc.text(`Cliente: 000000 - ${cliente.toUpperCase()}`, marginX, y);
      doc.text(`${hoje} ${hora}`, rightX, y, { align: "right" });
      y += 3;
      linha(y);
      y += 6;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Produto", marginX, y);
      doc.text("Qtd.", colQtd, y, { align: "center" });
      doc.text("Unid", colUnid, y, { align: "center" });
      doc.text("Descrição", colDesc, y);
      doc.text("Valor", colValor, y, { align: "right" });
      doc.text("Subtotal", rightX, y, { align: "right" });
      y += 2;
      linha(y);
      y += 6;
      doc.setFont("helvetica", "normal");
    };

    cabecalho();

    for (const item of itensValidos) {
      const qtdInt = Math.max(1, Math.round(num(item.qtd)));
      const sku = item.produto.eans[0] || item.produto.codigo;
      const descLinhas = doc.splitTextToSize(item.produto.descricao, 68);

      const alturaTexto = descLinhas.length * 4 + (item.obs ? 4 : 0);
      const alturaLinha = Math.max(alturaTexto, 5) + 22;
      if (y + alturaLinha > 278) {
        doc.addPage();
        pagina += 1;
        y = 16;
        cabecalho();
      }

      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(item.produto.familia || "-", marginX, y);
      doc.text(num(item.qtd).toFixed(2).replace(".", ","), colQtd, y, { align: "center" });
      doc.text(item.produto.unidade || "-", colUnid, y, { align: "center" });
      doc.text(descLinhas, colDesc, y);
      doc.text(num(item.preco).toFixed(2), colValor, y, { align: "right" });
      doc.text((num(item.qtd) * num(item.preco)).toFixed(2), rightX, y, { align: "right" });

      let yLinha = y + descLinhas.length * 4;
      if (item.obs) {
        doc.setFontSize(7.5);
        doc.setTextColor(110, 110, 110);
        doc.text(`Obs: ${item.obs}`, colDesc, yLinha);
        doc.setTextColor(0, 0, 0);
        yLinha += 4;
      }

      yLinha += 3;
      const barcodeUrl = gerarBarcodeDataURL(`${qtdInt}*${sku}`);
      doc.addImage(barcodeUrl, "PNG", marginX, yLinha, 55, 14);
      yLinha += 17;
      linha(yLinha);
      y = yLinha + 5;
    }

    y += 3;
    doc.setFontSize(10);
    doc.text("Subtotal", colValor, y, { align: "right" });
    doc.text(subtotal.toFixed(2), rightX, y, { align: "right" });
    y += 5;
    doc.text("Desconto", colValor, y, { align: "right" });
    doc.text(num(desconto).toFixed(2), rightX, y, { align: "right" });
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Total", colValor, y, { align: "right" });
    doc.text(total.toFixed(2), rightX, y, { align: "right" });

    if (observacao) {
      y += 10;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Observação: ${observacao}`, marginX, y, { maxWidth: rightX - marginX });
    }

    const nomeArquivo = `${numOrc}.pdf`;
    const blob = doc.output("blob");
    try {
      const arquivo = new File([blob], nomeArquivo, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], title: nomeArquivo });
        return;
      }
    } catch {
      // usuário cancelou o compartilhamento, ou não é suportado — cai no download
    }
    doc.save(nomeArquivo);
  };

  if (!autenticado) {
    return (
      <div style={{ minHeight: "100vh", background: CINZA_FUNDO, fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <form
          onSubmit={entrar}
          style={{ background: "white", borderRadius: 14, padding: "32px 28px", width: "100%", maxWidth: 320, boxShadow: "0 4px 20px rgba(0,0,0,.12)", textAlign: "center", boxSizing: "border-box" }}
        >
          <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 2 }}>
            Patro<span style={{ color: LARANJA }}>Tintas</span>
          </div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 22 }}>Orçamentos</div>
          <input
            type="password"
            autoFocus
            value={senhaInput}
            onChange={(e) => {
              setSenhaInput(e.target.value);
              setErroSenha(false);
            }}
            placeholder="Senha"
            style={{ width: "100%", padding: "12px 14px", fontSize: 16, border: `2px solid ${erroSenha ? "#C62828" : "#ddd"}`, borderRadius: 8, boxSizing: "border-box", textAlign: "center" }}
          />
          {erroSenha && <div style={{ color: "#C62828", fontSize: 13, marginTop: 8 }}>Senha incorreta</div>}
          <button
            type="submit"
            disabled={verificando}
            style={{ marginTop: 16, width: "100%", background: LARANJA, color: "white", border: "none", borderRadius: 8, padding: "12px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}
          >
            {verificando ? "Verificando…" : "Entrar"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: CINZA_FUNDO, fontFamily: "system-ui, sans-serif", paddingBottom: 90 }}>
      <style>{`
        input:focus { outline-color: ${LARANJA}; }
      `}</style>

      <div>
        {/* Topo fixo: marca + busca */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: LARANJA, padding: "10px 14px 12px", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 19 }}>
              Patro<span style={{ color: AMARELO }}>Tintas</span>
              <span style={{ fontWeight: 500, fontSize: 12, marginLeft: 8, opacity: 0.9 }}>Orçamento {numOrc.slice(-3)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Cliente padrão Consumidor — clica e edita */}
              <input
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                onFocus={(e) => e.target.select()}
                style={{ background: "rgba(255,255,255,.92)", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontWeight: 700, color: LARANJA_ESCURO, width: 130, textAlign: "right" }}
                title="Cliente (toque para modificar)"
              />
              <button
                onClick={() => setPainelProdutosAberto(true)}
                title="Gerenciar produtos"
                style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 6, padding: "6px 8px", fontSize: 14, cursor: "pointer" }}
              >
                📦
              </button>
              <button
                onClick={sair}
                title="Sair"
                style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 6, padding: "6px 8px", fontSize: 14, cursor: "pointer" }}
              >
                🔒
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={bipar}
              placeholder="🔍 Bipe o código ou digite código / descrição…"
              style={{ flex: 1, padding: "12px 14px", fontSize: 16, border: "none", borderRadius: 8, outline: `3px solid ${AMARELO}`, boxSizing: "border-box", minWidth: 0 }}
            />
            <button
              onClick={() => setCameraAberta(true)}
              title="Ler código de barras pela câmera"
              style={{ background: AMARELO, border: "none", borderRadius: 8, padding: "0 16px", fontSize: 20, cursor: "pointer" }}
            >
              📷
            </button>
          </div>
          {resultados.length > 0 && (
            <div style={{ background: "white", borderRadius: 8, marginTop: 6, overflow: "hidden", maxHeight: 250, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,.25)" }}>
              {resultados.map((p) => (
                <div key={p.codigo} onClick={() => adicionar(p)} style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.descricao}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      Cód. {p.codigo} · Custo {fmt(p.custo)}
                    </div>
                  </div>
                  <div style={{ color: LARANJA_ESCURO, fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(p.preco)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cameraAberta && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 16 }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: "100%", maxWidth: 480, borderRadius: 12, border: `3px solid ${AMARELO}` }}
            />
            <div style={{ color: "white", fontSize: 14 }}>Aponte a câmera para o código de barras</div>
            <button
              onClick={() => setCameraAberta(false)}
              style={{ background: "white", color: LARANJA_ESCURO, border: "none", borderRadius: 8, padding: "11px 28px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
            >
              Fechar
            </button>
          </div>
        )}

        {painelProdutosAberto && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "white", borderRadius: 14, padding: 24, width: "100%", maxWidth: 380, boxSizing: "border-box" }}>
              <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Produtos cadastrados</div>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 18 }}>
                {produtos.length} produto{produtos.length === 1 ? "" : "s"} na lista atual (salva neste aparelho)
              </div>

              <input
                ref={arquivoRef}
                type="file"
                accept=".xls,.xlsx,.csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importarArquivo(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => arquivoRef.current?.click()}
                disabled={importando}
                style={{ width: "100%", background: LARANJA, color: "white", border: "none", borderRadius: 8, padding: "12px", fontWeight: 800, fontSize: 14, cursor: "pointer", marginBottom: 8 }}
              >
                {importando ? "Importando…" : "📎 Escolher arquivo (.xls, .xlsx, .csv)"}
              </button>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 16 }}>
                Colunas esperadas: Codigo, Barras, Família, Descrição do produto, Custo, Preço Venda.
                Importar um arquivo <b>substitui</b> a lista atual.
              </div>

              <button
                onClick={excluirProdutos}
                style={{ width: "100%", background: "none", border: "1.5px solid #C62828", color: "#C62828", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}
              >
                Excluir todos os produtos
              </button>

              <button
                onClick={() => setPainelProdutosAberto(false)}
                style={{ width: "100%", background: "#eee", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {aviso && (
          <div style={{ position: "fixed", top: 120, left: "50%", transform: "translateX(-50%)", background: aviso.tipo === "ok" ? "#2E7D32" : "#C62828", color: "white", padding: "8px 16px", borderRadius: 8, zIndex: 30, fontSize: 13, maxWidth: "90%", textAlign: "center" }}>
            {aviso.msg}
          </div>
        )}

        {/* Orçamento sempre aberto */}
        <div style={{ padding: 12, maxWidth: 860, margin: "0 auto" }}>
          {itens.length === 0 ? (
            <div style={{ textAlign: "center", color: "#999", padding: "50px 20px", fontSize: 15 }}>
              Orçamento vazio.<br />Bipe um produto ou pesquise acima.
            </div>
          ) : (
            <div style={{ background: "white", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
              {itens.map((i) => (
                <div key={i.produto.codigo} style={{ padding: "10px 12px", borderBottom: "1px solid #f2f2f2" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      ref={(el) => (qtdRefs.current[i.produto.codigo] = el)}
                      type="text"
                      inputMode="decimal"
                      value={i.qtd}
                      onChange={(e) => alterar(i.produto.codigo, "qtd", e.target.value)}
                      style={{ width: 56, padding: "9px 4px", fontSize: 16, textAlign: "center", border: `2px solid ${LARANJA}`, borderRadius: 8, fontWeight: 700 }}
                    />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>
                      {i.produto.descricao}
                    </div>
                    <button onClick={() => remover(i.produto.codigo)} style={{ background: "none", border: "none", color: "#C62828", fontSize: 17, cursor: "pointer", padding: 2 }} title="Remover item">✕</button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, paddingLeft: 64, flexWrap: "wrap" }}>
                    {/* Preço de venda editável */}
                    <span style={{ fontSize: 12, color: "#666" }}>
                      Venda R${" "}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={i.preco}
                        onChange={(e) => alterar(i.produto.codigo, "preco", e.target.value)}
                        style={{ width: 80, padding: "4px 6px", fontSize: 13, border: "1.5px solid #ddd", borderRadius: 6, fontWeight: 600 }}
                      />
                    </span>
                    {/* CUSTO — sempre visível na tela, nunca no PDF */}
                    <span style={{ fontSize: 12, color: "#999", background: "#F5F5F5", padding: "3px 8px", borderRadius: 6 }}>
                      Custo {fmt(i.produto.custo)}
                    </span>
                    <span style={{ marginLeft: "auto", fontWeight: 700, color: LARANJA_ESCURO, fontSize: 15, whiteSpace: "nowrap" }}>
                      Total {fmt(num(i.qtd) * num(i.preco))}
                    </span>
                  </div>
                  {/* Observação do item (ex: lote, cor personalizada) */}
                  <input
                    value={i.obs}
                    onChange={(e) => alterarObs(i.produto.codigo, e.target.value)}
                    placeholder="Observação do item (ex: lote 123, cor personalizada…)"
                    style={{ marginTop: 6, marginLeft: 64, width: "calc(100% - 64px)", padding: "6px 10px", fontSize: 12, border: "1px dashed #ccc", borderRadius: 6, boxSizing: "border-box", color: "#555", fontStyle: i.obs ? "normal" : "italic" }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Observação geral — aparece no PDF */}
          <textarea
            placeholder="Observação do orçamento (aparece no PDF) — ex: entrega em 3 dias, pagamento à vista…"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            style={{ marginTop: 10, padding: "10px 12px", fontSize: 14, border: "1.5px solid #ddd", borderRadius: 8, boxSizing: "border-box", width: "100%", background: "white", fontFamily: "inherit", resize: "vertical" }}
          />

          {/* Desconto — aparece no PDF */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 13, color: "#666" }}>Desconto R$</span>
            <input
              type="text"
              inputMode="decimal"
              value={desconto}
              onChange={(e) => setDesconto(e.target.value.replace(/[^\d.,]/g, ""))}
              style={{ width: 90, padding: "6px 8px", fontSize: 14, border: "1.5px solid #ddd", borderRadius: 6, fontWeight: 600, textAlign: "right" }}
            />
          </div>
        </div>

        {/* Rodapé fixo: total + enviar PDF */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: `3px solid ${AMARELO}`, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, boxShadow: "0 -2px 10px rgba(0,0,0,.1)", zIndex: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "#888" }}>Total do orçamento</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: LARANJA_ESCURO }}>{fmt(total)}</div>
            <div style={{ fontSize: 12, color: "#999" }}>
              {num(desconto) > 0 && <>Subtotal {fmt(subtotal)} · Desconto {fmt(desconto)} · </>}
              Custo total {fmt(custoTotal)}
            </div>
          </div>
          <button onClick={enviarPDF} style={{ background: "#25D366", color: "white", border: "none", borderRadius: 10, padding: "13px 20px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
            📄 Enviar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
