const CSS = `
.mb-dash {
  height: 100%;
  overflow: auto;
  padding: 24px 28px 48px;
  background: #f3f6f6;
  color: #142224;
  font-family: "Iowan Old Style", Palatino, "Songti SC", serif;
}
.mb-kicker {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #3d6b66;
  margin-bottom: 8px;
}
.mb-title {
  font-size: 32px;
  line-height: 1.1;
  margin: 0 0 8px;
}
.mb-lead {
  max-width: 42rem;
  color: #3c4a48;
  margin: 0 0 20px;
}
.mb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.mb-card {
  background: #fff;
  border: 1px solid #d5e0de;
  border-radius: 12px;
  padding: 14px 16px;
}
.mb-card h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.mb-card p {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
}
.mb-ok { color: #1d6b45; }
.mb-bad { color: #8d3b32; }
.mb-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.mb-form input {
  flex: 1;
  border: 1px solid #c5d4d1;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  background: #fff;
}
.mb-form button, .mb-dock-chip {
  border: 1px solid #1f4f4a;
  background: #1f4f4a;
  color: #f4fbfa;
  border-radius: 999px;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
}
.mb-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #e4eeec;
  font-size: 15px;
}
.mb-code { font-variant-numeric: tabular-nums; }
.mb-note {
  margin-top: 16px;
  font-size: 13px;
  color: #5c6b69;
}
.mb-dock {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
}
.mb-dock-kicker {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #3d6b66;
}
.mb-dock-chip {
  background: transparent;
  color: #1f4f4a;
}
.mb-dock-chip-on { background: #1f4f4a; color: #f4fbfa; }
.mb-sidebar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.mb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1f4f4a;
}
`

export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-plugin-mirobody-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-plugin-mirobody-style'
  style.textContent = CSS
  document.head.appendChild(style)
}
