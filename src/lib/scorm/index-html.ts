function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Package launcher. Config is inlined (no fetch) with </ escaped so it can
 *  never close its own script tag. scorm-adapter loads BEFORE engine so
 *  window.ILBScorm exists at mount time. */
export function buildIndexHtml(opts: { title: string; configJson: string }): string {
  const safeJson = opts.configJson.replace(/<\//g, "<\\/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(opts.title)}</title>
  <link rel="stylesheet" href="engine/engine.css" />
</head>
<body>
  <div id="ilb-root"></div>
  <script id="ilb-config" type="application/json">${safeJson}</script>
  <script src="engine/scorm-adapter.js"></script>
  <script src="engine/engine.js"></script>
  <script>
    (function () {
      try {
        var config = JSON.parse(document.getElementById("ilb-config").textContent);
        window.ILBEngine.mount(document.getElementById("ilb-root"), config);
      } catch (err) {
        var root = document.getElementById("ilb-root");
        if (root) root.textContent = "Failed to load this lesson: " + (err && err.message ? err.message : err);
      }
    })();
  </script>
</body>
</html>
`;
}
