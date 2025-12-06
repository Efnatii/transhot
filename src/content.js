const OVERLAY_ID = "transhot-hover-overlay";
const ACTION_TRANSLATE = "translate";
const ACTION_SETTINGS = "settings";

let overlay;
let hideTimer;
let currentTarget;

const icons = {
  translate: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h8l-1 3H5.84c.55 1.6 1.63 3.04 3.09 4.39.91-.83 1.78-1.83 2.47-2.9h3.05c-.92 1.78-2.18 3.45-3.74 4.96l4.14 3.99-2.11 1.62-4.24-4.32c-1.37 1.07-2.93 1.96-4.7 2.71L2 14.92c1.38-.55 2.64-1.18 3.78-1.93C4.56 11.58 3.18 9.8 2.41 8H1l1-3h1Z" />
      <path d="M19.67 10h3.58L21 21h-3l-.66-3h-3.18L13.5 21h-2.94l4.94-11.86a1.5 1.5 0 0 1 1.39-.95h2.78ZM18.2 16.14h2.52l-.81-3.63h-.9l-.81 3.63Z" />
    </svg>
  `,
  settings: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.14 12.94a7.07 7.07 0 0 0 .05-.94 7.07 7.07 0 0 0-.05-.94l2-1.55a.5.5 0 0 0 .12-.64l-1.9-3.3a.5.5 0 0 0-.61-.22l-2.36.95a6.93 6.93 0 0 0-1.64-.94l-.36-2.48A.5.5 0 0 0 13.83 2h-3.66a.5.5 0 0 0-.5.43l-.36 2.48c-.6.24-1.16.55-1.67.94l-2.35-.95a.5.5 0 0 0-.61.22l-1.9 3.3a.5.5 0 0 0 .12.64l2 1.55a7.07 7.07 0 0 0-.05.94 7.07 7.07 0 0 0 .05.94l-2 1.55a.5.5 0 0 0-.12.64l1.9 3.3a.5.5 0 0 0 .61.22l2.35-.95c.5.39 1.07.7 1.67.94l.36 2.48a.5.5 0 0 0 .5.43h3.66a.5.5 0 0 0 .5-.43l.36-2.48c.6-.24 1.16-.55 1.66-.94l2.36.95a.5.5 0 0 0 .61-.22l1.9-3.3a.5.5 0 0 0-.12-.64l-2-1.55ZM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
    </svg>
  `
};

function ensureOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "transhot-overlay";
  overlay.innerHTML = `
    <button class="transhot-action" data-action="${ACTION_TRANSLATE}" aria-label="Перевести" title="Перевести">
      ${icons.translate}
      <span class="transhot-tooltip">Перевести</span>
    </button>
    <button class="transhot-action" data-action="${ACTION_SETTINGS}" aria-label="Настройки" title="Настройки">
      ${icons.settings}
      <span class="transhot-tooltip">Настройки</span>
    </button>
  `;

  overlay.addEventListener("mouseenter", clearHideTimer);
  overlay.addEventListener("mouseleave", scheduleHide);
  overlay.addEventListener("click", onOverlayClick);

  document.documentElement.appendChild(overlay);
  return overlay;
}

function onOverlayClick(event) {
  const button = event.target.closest(".transhot-action");
  if (!button) return;

  const action = button.dataset.action;
  if (action === ACTION_TRANSLATE) {
    console.info("Transhot: translate action triggered", currentTarget);
  } else if (action === ACTION_SETTINGS) {
    console.info("Transhot: settings action triggered");
  }
}

function handleMouseOver(event) {
  const target = event.target.closest("img, video");
  if (!target) return;

  currentTarget = target;
  const overlayElement = ensureOverlay();
  positionOverlay(overlayElement, target);
  showOverlay(overlayElement);
}

function handleMouseOut(event) {
  if (!currentTarget) return;
  if (overlay && overlay.contains(event.relatedTarget)) return;

  const leavingSameTarget = event.target === currentTarget && event.relatedTarget === currentTarget;
  if (leavingSameTarget) return;

  const relatedImage = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest("img, video");
  if (relatedImage === currentTarget) return;

  scheduleHide();
}

function showOverlay(element) {
  clearHideTimer();
  element.classList.add("visible");
}

function scheduleHide() {
  clearHideTimer();
  hideTimer = window.setTimeout(() => {
    overlay?.classList.remove("visible");
    currentTarget = undefined;
  }, 140);
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function positionOverlay(element, target) {
  const rect = target.getBoundingClientRect();
  const overlayWidth = element.offsetWidth || 76;
  const preferredTop = window.scrollY + rect.top + 10;
  const centeredLeft = window.scrollX + rect.left + (rect.width - overlayWidth) / 2;

  const minLeft = window.scrollX + rect.left + 6;
  const maxLeft = window.scrollX + rect.right - overlayWidth - 6;
  element.style.top = `${preferredTop}px`;
  element.style.left = `${Math.min(Math.max(minLeft, centeredLeft), maxLeft)}px`;
}

function init() {
  document.addEventListener("mouseover", handleMouseOver);
  document.addEventListener("mouseout", handleMouseOut);
}

init();
