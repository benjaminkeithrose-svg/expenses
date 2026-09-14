// Force the app to pick up a new deployment.
//
// The service worker is network-first for code, so a new build normally
// arrives on its own. Two cases where it doesn't, and this module exists for
// both:
//
//   - Assets (the spreadsheet library, icons, fonts) are cache-first and never
//     revalidate. They only change when sw.js bumps VERSION.
//   - Launched with no signal, network-first falls back to the cache. If the
//     next launch is also offline it can sit on an old build indefinitely.
//
// Nothing here touches IndexedDB, so statements, receipts and cash lines
// survive. Only the cached copy of the app itself is thrown away.

export const BUILD = "v7";

const BUSTER = "u";   // query param used to defeat the HTTP cache on reload

/**
 * Clear every cache, drop every service worker, reload from the network.
 * @param {(msg: string) => void} [step]  progress callback, for a toast
 */
export async function forceUpdate(step = () => {}) {
  step("Clearing cached app…");

  // Tell the worker to stand down first. It may still be controlling another
  // tab, and that copy would go on serving the caches we are about to clear.
  try { navigator.serviceWorker.controller?.postMessage("purge"); } catch {}

  // Order matters. Caches first: if the worker is unregistered first and the
  // page is closed mid-way, the caches are orphaned and the next load still
  // serves them.
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* private mode, or no Cache API — the reload still helps */ }

  step("Removing old worker…");
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* unsupported — nothing to remove */ }

  step("Reloading…");

  // A plain reload can still be answered from the browser's own HTTP cache.
  // GitHub Pages serves markup with a short max-age, so a unique query string
  // is the only reliable way to force a trip to the network.
  const url = new URL(location.href);
  url.searchParams.set(BUSTER, Date.now().toString(36));
  location.replace(url.toString());
}

/* Tidy the buster out of the address bar after the fresh load, so it doesn't
   end up bookmarked or saved as the PWA start_url. */
export function cleanURL() {
  const url = new URL(location.href);
  if (!url.searchParams.has(BUSTER)) return false;
  url.searchParams.delete(BUSTER);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;                       // we have just come back from an update
}

/* Ask the browser to check for a new worker. Cheap, and worth doing on every
   launch — it means most updates land without anyone pressing anything. */
export async function checkForUpdate() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch { /* offline, or unsupported */ }
}
