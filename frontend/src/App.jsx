import React, { useState, useEffect } from "react";
import * as d3 from "d3";
import "./App.css";

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
        console.log("Function click → raw server JSON:", j);
        console.log("Extracted cfg:", j.cfg);
        renderCfg(j.cfg);
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
  
    // blocks: object map { "%3": { start_line:..., end_line:... }, ... }
    const blocksMap = cfg.blocks && typeof cfg.blocks === "object" ? Object.assign({}, cfg.blocks) : {};
    const blockIds = Object.keys(blocksMap);
  
    // edges: may be null, [], or [{src, dst, type}, ...]
    const edges = Array.isArray(cfg.edges) ? cfg.edges.filter(Boolean) : [];
  
    // calls: may be null or array of { src, dst, type }
    const calls = Array.isArray(cfg.calls) ? cfg.calls.filter(Boolean) : [];
  
    // returns: array of { block: "%x", type: "ret" } or similar
    const returns = Array.isArray(cfg.returns) ? cfg.returns.map((r) => r.block).filter(Boolean) : [];
  
    const entry = cfg.entry || blockIds[0];
    if (!entry) {
      container.innerText = "CFG has no entry block.";
      return;
    }
  
    // Build adjacency map from edges (src -> [dst,...])
    const adjacency = {};
    for (const e of edges) {
      const s = e.src || e.from || null;
      const d = e.dst || e.to || null;
      if (!s || !d) continue;
      adjacency[s] = adjacency[s] || [];
      adjacency[s].push({ to: d, type: e.type || null });
    }
  
    // Build calls map from calls (src -> [dst,...])
    const callsMap = {};
    for (const c of calls) {
      const s = c.src || null;
      const d = c.dst || null;
      if (!s || !d) continue;
      callsMap[s] = callsMap[s] || [];
      callsMap[s].push({ dst: d, type: c.type || null });
    }
  
    // --- Build tree data starting from entry ---
    // We'll do a DFS, but avoid infinite recursion by tracking visited along current path.
    const visiting = new Set();
  
    function makeBlockName(id) {
      // Show id and annotate if it's a return block and optionally include start/end lines
      const meta = blocksMap[id] || {};
      let name = String(id);
      if (returns.includes(id)) name += " (ret)";
      // optionally show short start/end info:
      const s = meta.start_line, e = meta.end_line;
      if (s !== undefined && s !== null) name += ` [L${s}${e ? `-L${e}` : ""}]`;
      return name;
    }
  
    function buildTree(nodeId) {
      const nodeName = makeBlockName(nodeId);
      const node = { id: nodeId, name: nodeName, children: [] };
  
      // detect cycle on current path
      if (visiting.has(nodeId)) {
        // mark as back-edge and stop recursion
        return { id: nodeId, name: `${nodeName} (↩)`, children: [] };
      }
  
      visiting.add(nodeId);
  
      // 1) Add outgoing control-flow edges as children
      const outs = adjacency[nodeId] || [];
      for (const edge of outs) {
        const to = edge.to;
        if (!to) continue;
        if (visiting.has(to)) {
          node.children.push({ id: to, name: `${String(to)} (↩)`, children: [] });
        } else {
          node.children.push(buildTree(to));
        }
      }
  
      // 2) Add call nodes as annotated children (so calls appear under the block)
      const callsFrom = callsMap[nodeId] || [];
      for (const call of callsFrom) {
        // Represent calls as leaf children with distinct naming
        node.children.push({
          id: `${nodeId}->call:${call.dst}`,
          name: `call → ${call.dst}`,
          children: [],
        });
      }
  
      visiting.delete(nodeId);
      return node;
    }
  
    const treeData = buildTree(entry);
  
    // d3 collapsible tree rendering
    const width = container.clientWidth || 900;
    const height = container.clientHeight || 600;
    const margin = { top: 20, right: 120, bottom: 20, left: 120 };
  
    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("font", "12px sans-serif");
  
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
  
    const root = d3.hierarchy(treeData, (d) => d.children);
    root.x0 = innerHeight / 2;
    root.y0 = 0;
  
    // initially collapse deeper levels for readability
    if (root.children) root.children.forEach(collapse);
  
    const treeLayout = d3.tree().size([innerHeight, innerWidth]);
  
    update(root);
  
    // pan + zoom
    svg.call(
      d3.zoom().on("zoom", function (event) {
        g.attr("transform", event.transform);
      })
    );
  
    function collapse(d) {
      if (d.children) {
        d._children = d.children;
        d._children.forEach(collapse);
        d.children = null;
      }
    }
    function expand(d) {
      if (d._children) {
        d.children = d._children;
        d.children.forEach(expand);
        d._children = null;
      }
    }
  
    function update(source) {
      const duration = 300;
      const nodes = treeLayout(root).descendants();
      const links = treeLayout(root).links();
  
      nodes.forEach((d) => (d.y = d.depth * 160));
  
      // Nodes
      const node = g.selectAll("g.node").data(nodes, (d) => d.data.id || d.data.name);
  
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node")
        .attr("transform", (d) => `translate(${source.y0},${source.x0})`)
        .on("click", function (event, d) {
          // toggling children
          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else {
            d.children = d._children;
            d._children = null;
          }
          update(d);
        });
  
      nodeEnter
        .append("circle")
        .attr("class", "node-circle")
        .attr("r", 1e-6)
        .attr("stroke", "#333")
        .attr("fill", (d) => (d._children ? "#cfe2ff" : "#fff"));
  
      nodeEnter
        .append("text")
        .attr("dy", 3)
        .attr("x", (d) => (d.children || d._children ? -12 : 12))
        .style("text-anchor", (d) => (d.children || d._children ? "end" : "start"))
        .text((d) => d.data.name)
        .each(function () {
          const t = d3.select(this);
          const full = t.text();
          if (full.length > 40) t.text(full.slice(0, 36) + "…");
        });
  
      const nodeUpdate = nodeEnter.merge(node);
  
      nodeUpdate
        .transition()
        .duration(duration)
        .attr("transform", (d) => `translate(${d.y},${d.x})`);
  
      nodeUpdate.select("circle.node-circle").attr("r", 8).attr("fill", (d) => (d._children ? "#cfe2ff" : "#fff"));
  
      const nodeExit = node
        .exit()
        .transition()
        .duration(duration)
        .attr("transform", (d) => `translate(${source.y},${source.x})`)
        .remove();
  
      nodeExit.select("circle").attr("r", 1e-6);
      nodeExit.select("text").style("fill-opacity", 1e-6);
  
      // Links
      const link = g.selectAll("path.link").data(links, (d) => (d.target.data.id || d.target.data.name) + "<-" + (d.source.data.id || d.source.data.name));
  
      const linkEnter = link
        .enter()
        .insert("path", "g")
        .attr("class", "link")
        .attr("d", function () {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        })
        .attr("fill", "none")
        .attr("stroke", "#555")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1.5);
  
      const linkUpdate = linkEnter.merge(link);
      linkUpdate.transition().duration(duration).attr("d", diagonal);
  
      link
        .exit()
        .transition()
        .duration(duration)
        .attr("d", function () {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
        })
        .remove();
  
      nodes.forEach((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }
  
    function diagonal(d) {
      return `M ${d.source.y} ${d.source.x}
              C ${(d.source.y + d.target.y) / 2} ${d.source.x},
                ${(d.source.y + d.target.y) / 2} ${d.target.x},
                ${d.target.y} ${d.target.x}`;
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
