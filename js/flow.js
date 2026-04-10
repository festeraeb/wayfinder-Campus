// flow.js — Node-RED-style connection canvas for Wayfinder 2.0
//
// Left column  → "Do Now"   tasks  (output port on right edge)
// Right column → "Reference" items (input port on left edge)
//
// Usage:
//   Drag the ● port on a Do Now node to the ● port on a Reference node.
//   Hover a connection and click × to remove it.
//   Connections persist in localStorage.

const PAD      = 36;
const NODE_W   = 200;
const NODE_H   = 46;
const ROW_H    = NODE_H + 14;
const COL_L    = PAD;
const COL_R    = 490;
const WRAP_W   = COL_R + NODE_W + PAD;
const HDR_H    = 28;   // height reserved for column label

function nid(cat, text) {
  return `${cat}::${text.trim().slice(0, 80)}`;
}

function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

export class FlowView {
  constructor(wrapEl, nodesEl, svgEl_) {
    this.wrap  = wrapEl;
    this.nodes = nodesEl;
    this.svg   = svgEl_;
    this.STORE = 'cesarops_flow';
    this.conns = JSON.parse(localStorage.getItem(this.STORE) || '[]');
    this.pos   = {};   // id → { x, y }
    this.drag  = null; // { fromId, path }

    this._mm = e => this._dragMove(e);
    this._mu = ()  => this._dragCancel();
  }

  // Call when switching to flow view — reads current board state
  render(state) {
    this.nodes.innerHTML = '';
    this.svg.innerHTML   = '';
    this.pos = {};

    const left  = (state?.red?.items    || []).filter(s => s?.trim());
    const right = (state?.orange?.items || []).filter(s => s?.trim());
    const rows  = Math.max(left.length, right.length, 1);
    const H     = PAD + HDR_H + rows * ROW_H + PAD;

    this.wrap.style.width  = WRAP_W + 'px';
    this.wrap.style.height = H      + 'px';
    this.svg.setAttribute('width',   WRAP_W);
    this.svg.setAttribute('height',  H);
    this.svg.setAttribute('viewBox', `0 0 ${WRAP_W} ${H}`);

    // Column header labels
    this._colHeader('🔴 Do Now',    COL_L,  '#ef4444');
    this._colHeader('🟠 Reference', COL_R,  '#f97316');

    // Nodes
    left.forEach((text, i) => {
      const id = nid('red', text);
      const y  = PAD + HDR_H + i * ROW_H;
      this.pos[id] = { x: COL_L, y };
      this._makeNode(id, text, COL_L, y, '#ef4444', false, true);
    });

    right.forEach((text, i) => {
      const id = nid('orange', text);
      const y  = PAD + HDR_H + i * ROW_H;
      this.pos[id] = { x: COL_R, y };
      this._makeNode(id, text, COL_R, y, '#f97316', true, false);
    });

    // Empty-state hints
    if (!left.length)  this._emptyHint(COL_L,  'Add tasks to "Do Now"');
    if (!right.length) this._emptyHint(COL_R,  'Add items to "Reference"');

    // Prune stale connections and draw
    this.conns = this.conns.filter(c => this.pos[c.from] && this.pos[c.to]);
    this._save();
    this.conns.forEach(c => this._drawConn(c));
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  _colHeader(label, x, color) {
    const d = document.createElement('div');
    d.className = 'fn-col-hdr';
    d.style.cssText = `left:${x}px;top:${PAD}px;width:${NODE_W}px;color:${color}`;
    d.textContent = label;
    this.nodes.appendChild(d);
  }

  _emptyHint(x, text) {
    const d = document.createElement('div');
    d.className = 'fn-empty';
    d.style.cssText = `left:${x}px;top:${PAD + HDR_H}px;width:${NODE_W}px`;
    d.textContent = text;
    this.nodes.appendChild(d);
  }

  _makeNode(id, text, x, y, color, inPort, outPort) {
    const div = document.createElement('div');
    div.className = 'fn';
    div.style.cssText = `left:${x}px;top:${y}px;width:${NODE_W}px;height:${NODE_H}px;border-left-color:${color}`;
    div.title = text;

    const lbl = document.createElement('span');
    lbl.className   = 'fn-label';
    lbl.textContent = text;
    div.appendChild(lbl);

    if (inPort) {
      const p = document.createElement('div');
      p.className = 'fn-port fn-in';
      p.title = 'Drop connection here';
      p.addEventListener('mouseup', e => { e.stopPropagation(); this._dragEnd(id); });
      div.appendChild(p);
    }
    if (outPort) {
      const p = document.createElement('div');
      p.className = 'fn-port fn-out';
      p.title = 'Drag to a Reference item';
      p.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this._dragStart(id); });
      div.appendChild(p);
    }

    this.nodes.appendChild(div);
  }

  // ── Port positions ──────────────────────────────────────────────────────────

  _pxy(id, side) {
    const p = this.pos[id];
    if (!p) return null;
    return {
      x: side === 'out' ? p.x + NODE_W : p.x,
      y: p.y + NODE_H / 2,
    };
  }

  // ── Drag-to-connect ─────────────────────────────────────────────────────────

  _dragStart(fromId) {
    const draft = svgEl('path');
    draft.classList.add('fc-draft');
    this.svg.appendChild(draft);
    this.drag = { fromId, path: draft };
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('mouseup',   this._mu);
  }

  _dragMove(e) {
    if (!this.drag) return;
    const r  = this.svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const a  = this._pxy(this.drag.fromId, 'out');
    const cx = (a.x + mx) / 2;
    this.drag.path.setAttribute('d', `M${a.x} ${a.y} C${cx} ${a.y} ${cx} ${my} ${mx} ${my}`);
  }

  _dragEnd(toId) {
    if (!this.drag) return;
    const { fromId, path } = this.drag;
    path.remove();
    this.drag = null;
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup',   this._mu);

    if (!toId || fromId === toId) return;
    if (this.conns.find(c => c.from === fromId && c.to === toId)) return;

    const conn = { id: `c${Date.now()}`, from: fromId, to: toId };
    this.conns.push(conn);
    this._save();
    this._drawConn(conn);
  }

  _dragCancel() {
    if (this.drag) { this.drag.path.remove(); this.drag = null; }
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup',   this._mu);
  }

  // ── Draw a connection ───────────────────────────────────────────────────────

  _drawConn({ id, from, to }) {
    const a = this._pxy(from, 'out');
    const b = this._pxy(to,   'in');
    if (!a || !b) return;

    const cx = (a.x + b.x) / 2;   // bezier control x
    const mx = cx;                  // midpoint x for delete btn
    const my = (a.y + b.y) / 2;   // midpoint y for delete btn

    const d = `M${a.x} ${a.y} C${cx} ${a.y} ${cx} ${b.y} ${b.x} ${b.y}`;

    const g = svgEl('g');
    g.dataset.connId = id;
    g.classList.add('fc-group');

    // Visible line
    const vp = svgEl('path');
    vp.setAttribute('d', d);
    vp.classList.add('fc');
    g.appendChild(vp);

    // Wide invisible hit area (easier to click)
    const hp = svgEl('path');
    hp.setAttribute('d', d);
    hp.classList.add('fc-hit');
    hp.addEventListener('click', e => { e.stopPropagation(); this._del(id); });
    g.appendChild(hp);

    // Midpoint × delete button
    const btn = svgEl('g');
    btn.classList.add('fc-del');
    btn.setAttribute('transform', `translate(${mx},${my})`);
    btn.addEventListener('click', e => { e.stopPropagation(); this._del(id); });

    const ci = svgEl('circle');
    ci.setAttribute('r', '9');
    btn.appendChild(ci);

    const tx = svgEl('text');
    tx.textContent = '×';
    tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('dominant-baseline', 'central');
    btn.appendChild(tx);

    g.appendChild(btn);
    this.svg.appendChild(g);
  }

  _del(id) {
    this.conns = this.conns.filter(c => c.id !== id);
    this._save();
    this.svg.querySelector(`[data-conn-id="${id}"]`)?.remove();
  }

  _save() {
    localStorage.setItem(this.STORE, JSON.stringify(this.conns));
  }
}
