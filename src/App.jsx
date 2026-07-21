import { useState, useRef, useEffect, useMemo } from "react";

// ============================================================
// ORÇAMENTOS PATROTINTAS — v2
// • Orçamento sempre aberto (tela única)
// • Cliente padrão "Consumidor" (editável com um toque)
// • Custo SEMPRE visível na tela — NUNCA no PDF
// • "Enviar PDF" gera o PDF (imprimir → salvar) para anexar no WhatsApp
// ============================================================

const LARANJA = "#EE7203";
const LARANJA_ESCURO = "#C85E00";
const AMARELO = "#FFC20E";
const CINZA_FUNDO = "#F5F3F0";

// Produtos de exemplo — mesma estrutura do Excel (venda + custo)
const PRODUTOS = [
  { codigo: "000123", eans: ["7891234500011"], familia: "A", descricao: "FUTURA SUPER AMARELO 18L", preco: 300.0, custo: 198.5 },
  { codigo: "000124", eans: ["7891234500028"], familia: "A", descricao: "MASSA PVA FUTURA GL", preco: 30.0, custo: 17.2 },
  { codigo: "000125", eans: ["7891234500035"], familia: "A", descricao: "SUVINIL TOQUE DE SEDA BRANCO 18L", preco: 489.9, custo: 342.0 },
  { codigo: "000201", eans: ["7891234500110"], familia: "DP 1", descricao: "FUTURA ACRILICO PREMIUM BRANCO 3,6L", preco: 89.9, custo: 58.4 },
  { codigo: "000310", eans: ["7891234500219"], familia: "F 1", descricao: "MASSA CORRIDA CRISTAIS AMAIS 25KG", preco: 64.9, custo: 41.0 },
  { codigo: "000412", eans: ["7891234500318"], familia: "D1", descricao: "ROLO DE LA 23CM ATLAS", preco: 24.9, custo: 14.3 },
  { codigo: "000413", eans: ["7891234500325"], familia: "D1", descricao: "TRINCHA 2.1/2 TIGRE", preco: 12.9, custo: 6.8 },
  { codigo: "000414", eans: ["7891234500332"], familia: "D1", descricao: "FITA CREPE 48MM X 50M 3M", preco: 18.5, custo: 10.9 },
  { codigo: "000520", eans: ["7891234500417"], familia: "G", descricao: "SELADOR ACRILICO FARBEN 18L", preco: 149.9, custo: 96.0 },
];

const fmt = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function OrcamentoApp() {
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState([]); // {produto, qtd, preco}
  const [cliente, setCliente] = useState("Consumidor");
  const [observacao, setObservacao] = useState("");
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
                PRODUTOS.find((p) => p.eans.includes(valor)) ||
                PRODUTOS.find((p) => p.codigo === valor);
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
  }, [cameraAberta]);

  const resultados = useMemo(() => {
    const t = busca.trim().toUpperCase();
    if (!t) return [];
    return PRODUTOS.filter(
      (p) =>
        p.descricao.includes(t) ||
        p.codigo.includes(t) ||
        p.eans.some((e) => e.includes(t))
    ).slice(0, 8);
  }, [busca]);

  const mostrarAviso = (msg, tipo = "erro") => {
    setAviso({ msg, tipo });
    setTimeout(() => setAviso(null), 2200);
  };

  const adicionar = (produto) => {
    setItens((prev) => {
      const ix = prev.findIndex((i) => i.produto.codigo === produto.codigo);
      if (ix >= 0) {
        const novo = [...prev];
        novo[ix] = { ...novo[ix], qtd: novo[ix].qtd + 1 };
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
      PRODUTOS.find((p) => p.eans.includes(t)) ||
      PRODUTOS.find((p) => p.codigo === t);
    if (alvo) adicionar(alvo);
    else if (resultados.length === 1) adicionar(resultados[0]);
    else if (resultados.length === 0) {
      mostrarAviso("Código não encontrado no cadastro");
      setBusca("");
    }
  };

  const alterar = (codigo, campo, valor) =>
    setItens((prev) =>
      prev.map((i) =>
        i.produto.codigo === codigo
          ? { ...i, [campo]: Math.max(0, Number(valor) || 0) }
          : i
      )
    );

  const alterarObs = (codigo, valor) =>
    setItens((prev) =>
      prev.map((i) =>
        i.produto.codigo === codigo ? { ...i, obs: valor } : i
      )
    );

  const remover = (codigo) =>
    setItens((prev) => prev.filter((i) => i.produto.codigo !== codigo));

  const total = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const custoTotal = itens.reduce((s, i) => s + i.qtd * i.produto.custo, 0);
  const numOrc = useMemo(
    () =>
      "ORC-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      String(Math.floor(Math.random() * 900) + 100),
    []
  );
  const hoje = new Date().toLocaleDateString("pt-BR");

  // Enviar PDF: imprime SÓ o documento (custo fica de fora)
  const enviarPDF = () => {
    if (itens.filter((i) => i.qtd > 0).length === 0) {
      mostrarAviso("Adicione itens antes de gerar o PDF");
      return;
    }
    window.print();
  };

  const itensValidos = itens.filter((i) => i.qtd > 0);

  return (
    <div style={{ minHeight: "100vh", background: CINZA_FUNDO, fontFamily: "system-ui, sans-serif", paddingBottom: 90 }}>
      <style>{`
        @media print {
          .so-tela { display: none !important; }
          .so-pdf { display: block !important; }
          body { background: white !important; }
        }
        .so-pdf { display: none; }
        input:focus { outline-color: ${LARANJA}; }
      `}</style>

      {/* ================= TELA (não sai no PDF) ================= */}
      <div className="so-tela">
        {/* Topo fixo: marca + busca */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: LARANJA, padding: "10px 14px 12px", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 19 }}>
              Patro<span style={{ color: AMARELO }}>Tintas</span>
              <span style={{ fontWeight: 500, fontSize: 12, marginLeft: 8, opacity: 0.9 }}>Orçamento {numOrc.slice(-3)}</span>
            </div>
            {/* Cliente padrão Consumidor — clica e edita */}
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              onFocus={(e) => e.target.select()}
              style={{ background: "rgba(255,255,255,.92)", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontWeight: 700, color: LARANJA_ESCURO, width: 130, textAlign: "right" }}
              title="Cliente (toque para modificar)"
            />
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
                      type="number"
                      inputMode="numeric"
                      min={0}
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
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
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
                      Total {fmt(i.qtd * i.preco)}
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
        </div>

        {/* Rodapé fixo: total + enviar PDF */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: `3px solid ${AMARELO}`, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, boxShadow: "0 -2px 10px rgba(0,0,0,.1)", zIndex: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "#888" }}>Total do orçamento</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: LARANJA_ESCURO }}>{fmt(total)}</div>
            <div style={{ fontSize: 12, color: "#999" }}>
              Custo total {fmt(custoTotal)}
            </div>
          </div>
          <button onClick={enviarPDF} style={{ background: "#25D366", color: "white", border: "none", borderRadius: 10, padding: "13px 20px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
            📄 Enviar PDF
          </button>
        </div>
      </div>

      {/* ================= PDF (só aparece na impressão) ================= */}
      <div className="so-pdf">
        <div style={{ maxWidth: 720, margin: "0 auto", background: "white" }}>
          <div style={{ background: LARANJA, color: "white", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>
                Patro<span style={{ color: AMARELO }}>Tintas</span>
              </div>
              <div style={{ fontSize: 12 }}>WhatsApp (34) 3099-2828</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>ORÇAMENTO {numOrc}</div>
              <div>Data: {hoje}</div>
            </div>
          </div>

          <div style={{ padding: "12px 28px", borderBottom: `3px solid ${AMARELO}`, fontSize: 14 }}>
            <b>Cliente:</b> {cliente}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#FFF3E6", color: LARANJA_ESCURO }}>
                <th style={{ padding: "8px 10px", textAlign: "center" }}>Qtd</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>Descrição</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Unit.</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {itensValidos.map((i) => (
                <tr key={i.produto.codigo} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>{i.qtd}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {i.produto.descricao}
                    {i.obs && (
                      <div style={{ fontSize: 11, color: "#777", fontStyle: "italic" }}>
                        Obs: {i.obs}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(i.preco)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{fmt(i.qtd * i.preco)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ padding: "14px 28px", display: "flex", justifyContent: "flex-end" }}>
            <div style={{ background: LARANJA, color: "white", padding: "8px 18px", fontWeight: 800, fontSize: 16, borderRadius: 4 }}>
              TOTAL {fmt(total)}
            </div>
          </div>

          {observacao && (
            <div style={{ margin: "0 28px 14px", padding: "10px 14px", background: "#FFF8EC", borderLeft: `4px solid ${AMARELO}`, fontSize: 13 }}>
              <b>Observação:</b> {observacao}
            </div>
          )}

          <div style={{ padding: "0 28px 20px", fontSize: 11, color: "#999" }}>
            Orçamento válido por 7 dias. Este documento não é fiscal.
          </div>
        </div>
      </div>
    </div>
  );
}
