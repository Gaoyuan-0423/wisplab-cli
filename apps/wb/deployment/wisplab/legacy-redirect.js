// Runs when a legacy page opens. An already-open export session keeps its work.
(() => {
  const { target, deadline } = document.currentScript.dataset;
  const suffix = location.search + location.hash;
  if (!deadline || Date.now() >= Number(deadline)) {
    location.replace(target + suffix);
    return;
  }
  for (const link of document.querySelectorAll('a[data-wisplab-keep-location]')) {
    link.href += suffix;
  }
})();
