const scrollKey = 'portfolio-gallery-offset';
try {
  // A direct link to the work index from a project returns to the selected row.
  if (location.hash === '#work' && document.referrer.startsWith(location.origin + '/')) {
    const offset = Number(sessionStorage.getItem(scrollKey));
    if (Number.isFinite(offset) && offset > 0) {
      window.addEventListener('pageshow', () => requestAnimationFrame(() => scrollTo(0, offset)), { once: true });
    }
  }
  window.addEventListener('pagehide', () => sessionStorage.setItem(scrollKey, String(scrollY)));
} catch {
  // Browser-native navigation still works when storage is unavailable.
}
