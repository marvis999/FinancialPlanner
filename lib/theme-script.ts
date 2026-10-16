// Applied before paint to avoid a flash of the wrong theme. Shared with the
// static demo's layout (demo/app/layout.tsx).
export const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('financial-planner-theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
