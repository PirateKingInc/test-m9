// Dev panel: the AI camps' targeting (Phase 7, PHASE7_SPEC.md "Dev panel:
// targeting view"). Verification only, behind the dev panel toggle, never the
// normal HUD. It shows each brain's last computed rival ranking: it never asks
// a brain to compute one (that would change when the AI thinks).
import { TEAM_TEXT, ZONE_TEXT } from '../theme/names.js';
import { TEAM } from '../art/palette.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const named = (s) => String(s).replace(/camp (\d)/g, (_, t) => TEAM_TEXT[t] || `camp ${t}`)
  .replace(/claim (\w+)/, (_, z) => `claim ${ZONE_TEXT[z] || z}`).replace(/claiming (\w+)/, (_, z) => `claiming ${ZONE_TEXT[z] || z}`);
const camp = (t) => `<b style="color:${TEAM[t]?.base || '#ccc'}">${esc(TEAM_TEXT[t] || `camp ${t}`)}</b>`;

export function targetingHtml(brains) {
  const rows = [];
  for (const b of brains) {
    if (b.team === 1 || !b.w.camps || b.w.camps.length <= 2) continue; // AI camps in a free-for-all
    const i = b.intelCache;
    if (!b.core()) { rows.push(`<div class="dev-ai-camp">${camp(b.team)} · eliminated</div>`); continue; }
    const posture = b.stance ? named(b.stance) : 'building up (no wave yet)';
    const squad = b.squad ? ` · squad ${b.squad.kind === 'defend' ? 'defending' : 'retaking'} ${esc(ZONE_TEXT[b.squad.zone] || b.squad.zone)}` : '';
    const list = i ? i.ranking.map((r) => `<li${r.team === i.target ? ' class="pick"' : ''}>${camp(r.team)} <span class="score">${r.score.toFixed(2)}</span>`
      + `${r.scouted ? ` · R ${r.R.toFixed(2)}` : ''} · ${esc(named(r.why.join(', ')))}</li>`).join('') : '<li>no assessment yet</li>';
    rows.push(`<div class="dev-ai-camp">${camp(b.team)} · ${esc(posture)}${squad}${i?.cautious ? ' · <i>cautious</i>' : ''}<ol>${list}</ol></div>`);
  }
  return rows.join('');
}
