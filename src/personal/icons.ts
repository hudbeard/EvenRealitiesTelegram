const paths = {
  spark:
    '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/>',
  chats:
    '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z"/><path d="M7 9h9M7 13h6"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  users:
    '<path d="M16 21v-2a6 6 0 0 0-12 0v2M20 21v-2a6 6 0 0 0-3-5.2"/><circle cx="10" cy="7" r="3"/><path d="M16 4a3 3 0 0 1 0 6"/>',
  channel: '<path d="m4 10 14-6v16L4 14v-4ZM7 15l1 6h3l-1-5M21 9v6"/>',
  glasses:
    '<path d="M2 12h20M3 12l2-7h3M21 12l-2-7h-3"/><rect x="2" y="12" width="8" height="6" rx="2"/><rect x="14" y="12" width="8" height="6" rx="2"/><path d="M10 14a2 2 0 0 1 4 0"/>',
  change: '<path d="M4 7h15l-4-4M20 17H5l4 4M20 7l-5 4M4 17l5-4"/>',
  reply: '<path d="m9 5-6 6 6 6M3 11h10a7 7 0 0 1 7 7v2"/>',
  bookmark: '<path d="M6 3h12v19l-6-4-6 4V3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  refresh:
    '<path d="M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M21 21v-5h-5"/>',
  shield:
    '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 11 3 3 5-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01"/>',
  left: '<path d="m14 5-7 7 7 7"/>',
  right: '<path d="m10 5 7 7-7 7"/>',
  up: '<path d="m5 14 7-7 7 7"/>',
  down: '<path d="m5 10 7 7 7-7"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  thumb:
    '<path d="M8 10 12 2c3 0 3 3 2 7h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H8V10ZM3 10h5v11H3Z"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M10 3H4v18h6M10 12h12m-4-4 4 4-4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  filter: '<path d="M3 5h18M6 12h12M9 19h6"/>',
  file: '<path d="M5 2h9l5 5v15H5V2ZM14 2v6h5M8 12h8M8 16h6"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  volume:
    '<path d="m3 9 5-1 5-5v18l-5-5-5-1V9ZM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>',
  loading: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  inbox:
    '<path d="m3 4-2 12v5h22v-5L21 4H3ZM1 16h6l2 3h6l2-3h6M7 8h10M9 12h6"/>',
};
export type IconName = keyof typeof paths;
export function icon(name: IconName, className = "") {
  return `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
export function symbol(name: IconName, className = "") {
  const span = document.createElement("span");
  span.className = "symbol " + className;
  span.innerHTML = icon(name);
  return span;
}
export function buttonLabel(
  button: HTMLElement,
  name: IconName,
  label: string,
) {
  button.replaceChildren(symbol(name), document.createTextNode(label));
}
