/**
 * Loading screen (markup in index.html, outside #app so mounting the
 * workbench does not remove it). Reports real start-up stages and fades out
 * once the first frame is drawn.
 */
export function bootProgress(fraction: number, label: string) {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.style.setProperty("--boot-progress", String(Math.min(1, fraction)));
  boot
    .querySelector('[role="progressbar"]')
    ?.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  const status = boot.querySelector(".boot-status");
  if (status) status.textContent = label;
}

export function bootDone() {
  const boot = document.getElementById("boot");
  if (!boot || boot.dataset.done) return;
  bootProgress(1, "Ready");
  boot.dataset.done = "true";
  boot.classList.add("boot-hidden");
  window.setTimeout(() => boot.remove(), 450);
}
