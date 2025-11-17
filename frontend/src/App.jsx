import React, { useState, useEffect } from "react";
import * as d3 from "d3";

function formatPct(p) {
  if (p === null || p === undefined) return "n/a";
  return `${Math.round(p * 100) / 100}%`;
}

export default function App() {
  const [functions, setFunctions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [regex, setRegex] = useState("");
  const [sortBy, setSortBy] = useState("coverage");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedFunc, setSelectedFunc] = useState(null);
  const [cfgData, setCfgData] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, regex, sortBy, sortDir]);

  async function fetchPage() {
    setStatus("Fetching...");
    const params = new URLSearchParams();
    params.set("page", page);
    params.set("limit", limit);
    if (regex) params.set("regex", regex);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    try {
      const res = await fetch(`/functions?${params.toString()}`);
      const j = await res.json();
      if (j.error) {
        setStatus(`Error: ${j.error}`);
        setFunctions([]);
        return;
      }
      setFunctions(j.functions || []);
      setTotal(j.total || 0);
      setStatus("");
    } catch (e) {
      setStatus(`Failed to fetch: ${e.message}`);
    }
  }

  async function loadCoverageFromPath(path) {
    if (!path) return;
    setStatus("Loading coverage JSON from server path...");
    try {
      const res = await fetch(`/load-coverage-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const j = await res.json();
      if (res.ok) {
        setStatus(`Coverage loaded. ${j.functions_loaded} functions indexed.`);
        setPage(1);
        fetchPage();
      } else {
        setStatus(`Load failed: ${j.error || JSON.stringify(j)}`);
      }
    } catch (e) {
      setStatus(`Load failed: ${e.message}`);
    }
  }

  async function loadCfgDir(path) {
    setStatus("Scanning CFG directory...");
    try {
      const res = await fetch(`/load-cfg-dir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const j = await res.json();
      if (res.ok) {
        setStatus(`CFG loaded. Functions with CFG: ${j.functions_with_cfg}`);
      } else setStatus(`CFG load failed: ${j.error || JSON.stringify(j)}`);
    } catch (e) {
      setStatus(`CFG load failed: ${e.message}`);
    }
  }

  async function chooseFunction(fn) {
    setSelectedFunc(fn);
    setStatus("Fetching CFG...");
    try {
      const res = await fetch(`/function/${encodeURIComponent(fn.name)}`);
      const j = await res.json();
      if (res.ok) {
        setCfgData(j.cfg || null);
        setStatus("");
        setTimeout(() => renderCfg(j.cfg), 50);
      } else {
        setStatus(`Failed to fetch CFG: ${j.error}`);
      }
    } catch (e) {
      setStatus(`Failed to fetch CFG: ${e.message}`);
    }
  }

  function renderCfg(cfg) {
    const container = document.getElementById("cfg-canvas");
    if (!container) return;
    container.innerHTML = "";
    if (!cfg) {
      container.innerText = "No CFG available for this function.";
      return;
    }

    const width = container.clientWidth || 900;
    const height = 600;

    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

    const blocks = Object.keys(cfg.blocks || {});
    const nodes = blocks.map((b, i) => ({ id: b, idx: i }));

    let links = [];
    if (Array.isArray(cfg.edges)) {
      links = cfg.edges.map((e) => ({ source: e[0] || e.from, target: e[1] || e.to }));
    } else if (cfg.edges && typeof cfg.edges === "object") {
      for (const [from, tos] of Object.entries(cfg.edges)) {
        for (const to of tos || []) links.push({ source: from, target: to });
      }
    }

    const simulation = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("link", d3.forceLink(links).id((d) => d.id).distance(120))
      .on("tick", ticked);

    const link = svg.append("g").attr("stroke", "#999").selectAll("line").data(links).join("line").attr("stroke-width", 1.5);
    const node = svg.append("g").selectAll("g").data(nodes).join("g").call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));

    node.append("circle").attr("r", 24).attr("fill", "#f3f4f6").attr("stroke", "#333");
    node.append("text").text((d) => d.id).attr("dy", 4).attr("text-anchor", "middle").attr("font-size", 10);

    function ticked() {
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    }

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>llvm-cov + CFG viewer</h1>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div>
            <label>Load coverage JSON (server path)</label>
            <br />
            <input id="coverage-path-input" type="text" placeholder="/abs/path/to/coverage.json" style={{ width: 360 }} />
            <br />
            <button onClick={() => loadCoverageFromPath(document.getElementById("coverage-path-input").value)}>
              Load Coverage
            </button>
          </div>
        </div>

        <div>
          <label>Load CFG directory (server path)</label>
          <br />
          <input id="cfg-path-input" type="text" placeholder="/abs/path/to/cfgs" style={{ width: 360 }} />
          <br />
          <button onClick={() => loadCfgDir(document.getElementById("cfg-path-input").value)}>Load</button>
        </div>

        <div>
          <label>Regex (search SOURCE FILE)</label>
          <br />
          <input value={regex} onChange={(e) => setRegex(e.target.value)} placeholder="regex" style={{ width: 240 }} />
        </div>

        <div>
          <label>Sort</label>
          <br />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="alpha">name (alpha)</option>
            <option value="coverage">coveragePct</option>
            <option value="missed">total missed</option>
          </select>
          <select value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>{status}</div>

      <div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Function</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>File</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Coverage</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>missed</th>
            </tr>
          </thead>
          <tbody>
            {functions.map((f) => (
              <tr key={f.name} onClick={() => chooseFunction(f)} style={{ cursor: "pointer" }}>
                <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{f.name}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{f.file}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{formatPct(f.coveragePct)}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{(f.total || 0) - (f.covered || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span style={{ margin: "0 8px" }}>Page {page} — {total} results</span>
          <button onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        {selectedFunc && (
          <div>
            <h2>CFG for: {selectedFunc.name}</h2>
            <div id="cfg-canvas" style={{ width: "100%", height: 600, border: "1px solid #ddd" }}></div>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{JSON.stringify(cfgData, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
