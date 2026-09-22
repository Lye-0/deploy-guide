/** Enhances native selects; the original element remains the value/event source. */
export function enhanceSelects() {
  const controls: { sync(): void }[] = [];
  let closeActive: (() => void) | null = null;
  for (const select of document.querySelectorAll<HTMLSelectElement>('select')) {
    const wrapper = document.createElement('div'); wrapper.className = 'select-control';
    select.before(wrapper); wrapper.append(select);
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.id = select.id + '-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span'); value.className = 'select-value';
    const arrow = document.createElement('span'); arrow.className = 'select-chevron'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '⌄';
    trigger.append(value, arrow); wrapper.append(trigger);
    const label = document.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`);
    const name = label?.textContent?.trim() || '選択';
    if (label) label.htmlFor = trigger.id;
    if (select.getAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', select.getAttribute('aria-describedby')!);
    select.hidden = true;
    const popup = document.createElement('div'); popup.className = 'select-popup'; popup.hidden = true;
    const search = document.createElement('input'); search.type = 'search'; search.className = 'select-search'; search.placeholder = 'フォルダ名で検索…'; search.setAttribute('aria-label', `${name}の候補を検索`); search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list');
    const list = document.createElement('div'); list.className = 'select-options'; list.id = select.id + '-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', name);
    trigger.setAttribute('aria-controls', list.id); search.setAttribute('aria-controls', list.id);
    const footer = document.createElement('div'); footer.className = 'select-footer'; footer.setAttribute('role', 'status');
    popup.append(search, list, footer); document.body.append(popup);
    let opened = false, active = -1, matches: HTMLOptionElement[] = [], searchable = false;
    function close(restore = false) {
      if (!opened) return;
      opened = false; popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant'); search.removeAttribute('aria-activedescendant');
      if (restore) trigger.focus();
    }
    function position() {
      if (!opened) return;
      const r = trigger.getBoundingClientRect();
      if (!trigger.getClientRects().length || r.bottom < 0 || r.top > innerHeight) { close(); return; }
      const below = innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 240 && above > below;
      const max = Math.max(120, Math.min(350, up ? above : below));
      popup.style.width = `${Math.min(r.width, innerWidth - 24)}px`;
      popup.style.left = `${Math.max(12, Math.min(r.left, innerWidth - r.width - 12))}px`;
      popup.style.maxHeight = `${max}px`;
      list.style.maxHeight = `${Math.max(44, max - (searchable ? 93 : 43))}px`;
      popup.style.top = up ? 'auto' : `${r.bottom + 6}px`;
      popup.style.bottom = up ? `${innerHeight - r.top + 6}px` : 'auto';
    }
    function focusOption(index: number, scroll = true) {
      active = index;
      Array.from(list.children).forEach((row, i) => row.classList.toggle('is-active', i === active));
      const owner = searchable ? search : trigger;
      if (active >= 0) { owner.setAttribute('aria-activedescendant', `${select.id}-option-${active}`); if (scroll) list.children[active]?.scrollIntoView({ block: 'nearest' }); }
      else owner.removeAttribute('aria-activedescendant');
    }
    function choose(index: number) {
      const option = matches[index]; if (!option) return;
      select.value = option.value; close(true); sync(); select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function draw() {
      const query = search.value.trim().toLocaleLowerCase();
      matches = Array.from(select.options).filter(o => !o.disabled && o.text.toLocaleLowerCase().includes(query));
      list.replaceChildren();
      for (const [i, option] of matches.entries()) {
        const row = document.createElement('div'); row.className = 'select-option'; row.id = `${select.id}-option-${i}`; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected));
        const text = document.createElement('span'); text.textContent = option.text;
        const check = document.createElement('span'); check.className = 'select-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = option.selected ? '✓' : '';
        row.append(text, check); row.addEventListener('pointerdown', e => e.preventDefault()); row.addEventListener('click', () => choose(i));
        row.addEventListener('pointermove', () => focusOption(i, false)); list.append(row);
      }
      footer.textContent = matches.length ? `${matches.length.toLocaleString()}件${searchable ? ' · ↑↓で移動 / Enterで選択' : ''}` : '一致する候補がありません';
      focusOption(matches.length ? Math.max(0, matches.findIndex(o => o.selected)) : -1, false);
      list.scrollTop = 0; position();
    }
    function open() {
      closeActive?.(); closeActive = () => close();
      opened = true; searchable = select.options.length > 8; search.hidden = !searchable; search.value = '';
      trigger.setAttribute('role', searchable ? 'button' : 'combobox');
      popup.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
      draw(); position();
      if (searchable) search.focus();
      focusOption(active);
    }
    function sync() {
      value.textContent = select.selectedOptions[0]?.text || '選択してください'; trigger.title = value.textContent;
      trigger.setAttribute('aria-label', `${name}：${value.textContent}`); trigger.disabled = select.disabled || !select.options.length;
      if (opened) draw();
    }
    function keydown(e: KeyboardEvent) {
      if (!opened) { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); } return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(true);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (matches.length) focusOption((active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); }
      else if (!searchable && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); focusOption(e.key === 'Home' ? 0 : matches.length - 1); }
      else if (e.key === 'Enter' || (!searchable && e.key === ' ')) { e.preventDefault(); choose(active); }
    }
    trigger.addEventListener('click', () => opened ? close() : open()); trigger.addEventListener('keydown', keydown); search.addEventListener('keydown', keydown);
    search.addEventListener('input', draw); select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
    document.addEventListener('pointerdown', e => { if (!popup.contains(e.target as Node) && !wrapper.contains(e.target as Node)) close(); });
    document.addEventListener('focusin', e => { if (opened && !popup.contains(e.target as Node) && !wrapper.contains(e.target as Node)) close(); });
    window.addEventListener('resize', position); window.addEventListener('scroll', e => { if (!popup.contains(e.target as Node)) position(); }, true);
    controls.push({ sync }); sync();
  }
  return () => controls.forEach(c => c.sync());
}
