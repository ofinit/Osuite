// The documents index: selecting a name shows its sheet on the stage (a tab list).
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.out-name')];
const select = (tab: HTMLButtonElement, focus = false) => {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')!)!.hidden = !on;
    const id = t.id.replace(/^tab-/, '');
    const note = document.querySelector<HTMLElement>(`[data-note-for="${id}"]`);
    if (note) note.hidden = !on;
  }
  if (focus) tab.focus();
};
tabs.forEach((t, i) => {
  t.tabIndex = i === 0 ? 0 : -1;
  t.addEventListener('click', () => select(t));
  t.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    select(tabs[(i + step + tabs.length) % tabs.length]!, true);
  });
});
