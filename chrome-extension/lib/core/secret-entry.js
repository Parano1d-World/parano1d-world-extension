// Secret entry, the same on the website, desktop wallet and extension, matching the Parano1d iPhone app:
//  - master key: 16 numbered boxes of 4 hex characters, hidden while typing, "Show for 15 seconds", Edit per box,
//    auto-move to the next box after 4 valid characters, invalid characters refused (you stay in that box),
//    and pasting the whole 64-character key into any box fills all 16;
//  - master key display: the same 16 numbered groups;
//  - PIN: a 4-digit or 6-digit choice (6 recommended), shown as dots.
// Built with DOM calls only (no HTML strings), so it works under the strict CSP and Trusted Types everywhere.
const HEX = /[0-9a-f]/;
function node(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v)); }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}

/** The master key as 16 numbered groups of 4 (for the backup screen). */
export function keyDisplay(hex) {
  const g = String(hex || '').toLowerCase().match(/.{1,4}/g) || [];
  return node('ol', { class: 'sx-keyview', 'aria-label': 'Master key, 16 groups of 4 characters' },
    g.map((s, i) => node('li', {}, node('span', { class: 'sx-n', text: String(i + 1), 'aria-hidden': 'true' }), node('span', { class: 'sx-g', text: s }))));
}

/**
 * Master key entry. Returns { root, value(), clear(), focus() }. `firstId` is the id of box 1 (so a label can
 * point at it); onChange(value, complete) runs on every change.
 */
export function keyGrid({ firstId = 'sx-key-1', label = 'Parano1d master key', onChange = () => {} } = {}) {
  const boxes = [], note = node('p', { class: 'sx-note', 'aria-live': 'polite' }), count = node('p', { class: 'sx-count', 'aria-live': 'polite' });
  let showUntil = 0, showTimer = null;
  const value = () => boxes.map(b => b.value).join('');
  const update = () => {
    const v = value(); count.textContent = `${v.length} of 64 characters · Letters A–F and digits 0–9`;
    show.disabled = !v.length; onChange(v, v.length === 64);
  };
  const setVisible = on => { for (const b of boxes) b.type = on ? 'text' : 'password'; show.textContent = on ? 'Hide entered key' : 'Show entered key for 15 seconds'; show.setAttribute('aria-pressed', String(on)); };
  const show = node('button', { type: 'button', class: 'mini sx-show', 'aria-pressed': 'false', text: 'Show entered key for 15 seconds', disabled: true });
  show.onclick = () => {
    clearTimeout(showTimer);
    if (showUntil > Date.now()) { showUntil = 0; setVisible(false); return; }
    showUntil = Date.now() + 15000; setVisible(true); showTimer = setTimeout(() => { showUntil = 0; setVisible(false); }, 15000);
  };
  const fillAll = hex => { for (let i = 0; i < 16; i++) boxes[i].value = hex.slice(i * 4, i * 4 + 4); note.textContent = ''; boxes[15].blur(); update(); };
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const inp = node('input', { id: i === 0 ? firstId : `${firstId}-${i + 1}`, class: 'sx-box', type: 'password', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', maxlength: '64', placeholder: '••••', 'aria-label': `Master key group ${i + 1} of 16` });
    inp.addEventListener('input', () => {
      const raw = inp.value.toLowerCase().replace(/\s/g, '');
      // A whole key pasted (or typed) into any box fills all 16 groups.
      if (/^[0-9a-f]{64}$/.test(raw)) return fillAll(raw);
      const clean = [...raw].filter(c => HEX.test(c)).join('');
      if (clean.length !== raw.length) note.textContent = `Group ${i + 1}: only the digits 0–9 and the letters A–F are used. Fix this group to continue.`;
      else if (note.textContent.startsWith(`Group ${i + 1}:`)) note.textContent = '';
      inp.value = clean.slice(0, 4);
      // Full group: move on. An invalid character keeps you here to fix it.
      if (inp.value.length === 4 && clean.length === raw.length) { if (i < 15) boxes[i + 1].focus(); else inp.blur(); }
      update();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && i > 0) { e.preventDefault(); boxes[i - 1].focus(); } });
    const edit = node('button', { type: 'button', class: 'sx-edit', text: 'Edit', 'aria-label': `Clear and re-enter group ${i + 1}` });
    edit.onclick = () => { inp.value = ''; note.textContent = ''; inp.focus(); update(); };
    boxes.push(inp);
    cells.push(node('div', { class: 'sx-cell' }, node('span', { class: 'sx-n', text: String(i + 1), 'aria-hidden': 'true' }), inp, edit));
  }
  const root = node('div', { class: 'sx-keygrid', role: 'group', 'aria-label': label },
    node('p', { class: 'sx-help', text: '16 groups of 4 characters. Typing moves to the next group by itself. Paste the whole 64-character key into the first box to fill all groups. Tap Edit beside a group to correct it.' }),
    show, node('div', { class: 'sx-grid' }, cells), count, note);
  update();
  return { root, value, focus: () => boxes[0].focus(), clear: () => { for (const b of boxes) b.value = ''; clearTimeout(showTimer); setVisible(false); update(); } };
}

export const PIN_LENGTHS = [6, 4];
/** PIN entry shown as dots (the field itself stays a password field, so phones show the number pad). */
export function pinEntry({ id, digits = 6, label = 'PIN', onInput = () => {} }) {
  const dots = node('div', { class: 'sx-dots', 'aria-hidden': 'true' });
  const inp = node('input', { id, class: 'sx-pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: String(digits), 'aria-label': `${label}, ${digits} digits` });
  const draw = () => { dots.replaceChildren(...Array.from({ length: Number(inp.maxLength) }, (_, k) => node('span', { class: k < inp.value.length ? 'on' : '' }))); };
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, inp.maxLength); draw(); onInput(inp.value); });
  draw();
  const root = node('div', { class: 'sx-pinbox' }, dots, inp);
  return { root, input: inp, value: () => inp.value, clear: () => { inp.value = ''; draw(); }, setDigits: n => { inp.maxLength = n; inp.setAttribute('aria-label', `${label}, ${n} digits`); inp.value = ''; draw(); } };
}

/** "6-digit PIN" / "4-digit PIN" choice, 6 selected. onChange(digits). */
export function pinChooser(onChange = () => {}, selected = 6) {
  const note = node('p', { class: 'sx-help sx-pinnote' });
  const btns = PIN_LENGTHS.map(n => node('button', { type: 'button', class: 'sx-seg', role: 'radio', 'aria-checked': String(n === selected), 'data-digits': String(n), text: `${n}-digit PIN${n === 6 ? ' (recommended)' : ''}` }));
  const pick = n => { for (const b of btns) b.setAttribute('aria-checked', String(Number(b.dataset.digits) === n)); note.textContent = n === 4 ? 'A 4-digit PIN is easier to guess. Six digits is recommended.' : ''; onChange(n); };
  for (const b of btns) b.onclick = () => pick(Number(b.dataset.digits));
  const root = node('div', { class: 'sx-pinchoice' }, node('div', { class: 'sx-segs', role: 'radiogroup', 'aria-label': 'PIN length' }, btns), note);
  return { root, pick };
}
