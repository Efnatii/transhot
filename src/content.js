const OVERLAY_ID = "transhot-hover-overlay";
const ACTION_TRANSLATE = "translate";

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
};

function ensureOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "transhot-overlay";
  overlay.innerHTML = `
    <button class="transhot-action transhot-fancy-button" data-action="${ACTION_TRANSLATE}" aria-label="Перевести">
      <span class="transhot-button-surface">
        <span class="text">Submit</span>
        <span class="progress-bar" aria-hidden="true"></span>
        <svg viewBox="0 0 25 30" aria-hidden="true">
          <path class="check" d="M2,19.2C5.9,23.6,9.4,28,9.4,28L23,2" />
        </svg>
      </span>
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

  startButtonAnimation(button);

  const action = button.dataset.action;
  if (action === ACTION_TRANSLATE) {
    console.info("Transhot: translate action triggered", currentTarget);
  }
}

function startButtonAnimation(button) {
  const progressBar = button.querySelector(".progress-bar");
  const checkPath = button.querySelector(".check");
  if (!progressBar || !checkPath) return;

  if (button.dataset.animating === "true") return;
  button.dataset.animating = "true";

  const pathLength = checkPath.getTotalLength();
  checkPath.style.strokeDasharray = pathLength.toString();
  checkPath.style.strokeDashoffset = pathLength.toString();

  button.classList.remove("is-complete");
  button.classList.add("is-animating");

  progressBar.style.transition = "none";
  progressBar.style.width = "0px";
  // Force style updates before applying the transition
  void progressBar.offsetWidth;
  progressBar.style.transition = "width 1800ms linear";
  progressBar.style.width = "100%";

  window.setTimeout(() => {
    button.classList.remove("is-animating");
    button.classList.add("is-complete");
    progressBar.style.transition = "width 250ms ease";
    progressBar.style.width = "0";
    checkPath.style.transition = "stroke-dashoffset 260ms ease-in-out";
    checkPath.style.strokeDashoffset = "0";
    window.setTimeout(() => {
      button.dataset.animating = "false";
    }, 500);
  }, 2000);
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
