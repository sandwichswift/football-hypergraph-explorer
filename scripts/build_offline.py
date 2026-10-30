"""Build a self-contained, double-clickable offline HTML and local handoff ZIP.

Standard library only. Run prepare_data.py first. Original A/B/C modules and
D3 remain intact; only local asset references are rewritten in the package.
Generated files contain licensed match data and belong under ignored output/.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
from pathlib import Path
import re
import sys
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = {
    "players": "players.json", "events": "events.json", "stats": "stats.json",
    "collaborationEdges": "collaboration_edges.json", "competitionEdges": "competition_edges.json",
}
MODULE_FILES = ["state.js", "competitionTimeline.js", "dataExplorer.js", "playerAnalysis.js", "vendor/d3.v7.9.0.js", "hypergraph.js", "main.js"]
ASSET = re.compile(r'new URL\(("|\')([^"\']+)\1,\s*import\.meta\.url\)\.href')


def data_url(path):
    mime = {".png": "image/png", ".css": "text/css", ".pdf": "application/pdf"}[path.suffix]
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def embedded_json(value):
    # HTML's script end tag is recognized even inside JSON strings.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


BOOTSTRAP = r"""
const payload = JSON.parse(document.getElementById('offline-payload').textContent);
const urls = new Map();
const sources = payload.sources;
function resolveModule(specifier, owner) {
  const parts = owner.split('/'); parts.pop();
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
function moduleUrl(name, ancestry = []) {
  if (urls.has(name)) return urls.get(name);
  if (!Object.hasOwn(sources, name)) throw new Error('离线包缺少模块：' + name);
  if (ancestry.includes(name)) throw new Error('离线模块依赖出现循环：' + name);
  const source = sources[name].replace(/^(import\s+[^;\n]+?\s+from\s+)(["'])(\.[^"']+)\2\s*;/gm,
    (_, prefix, quote, specifier) => prefix + JSON.stringify(moduleUrl(resolveModule(specifier, name), [...ancestry, name])) + ';');
  const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
  urls.set(name, url); return url;
}
try {
  const importModule = specifier => import(moduleUrl(resolveModule(specifier, 'src/js/main.js')));
  const main = await import(moduleUrl('src/js/main.js'));
  const app = await main.startApp(document, {dataset: payload.dataset, importModule});
  addEventListener('pagehide', () => { app.destroy(); for (const url of urls.values()) URL.revokeObjectURL(url); }, {once: true});
} catch (error) {
  document.getElementById('app-status').textContent = '离线网页未能启动。';
  const errors = document.getElementById('app-errors'); errors.hidden = false;
  errors.textContent = error.message + '\n请使用完整生成的 HTML，并用现代 Chrome 或 Edge 打开。';
  document.querySelector('.app-diagnostics').open = true;
}
"""


def build(output, *, data_dir=None):
    data_dir = data_dir or ROOT / "data/processed"
    dataset = {key: json.loads((data_dir / name).read_text(encoding="utf-8-sig")) for key, name in DATA_FILES.items()}
    for key in DATA_FILES:
        if not isinstance(dataset[key], dict if key == "stats" else list):
            raise ValueError(f"{DATA_FILES[key]} has the wrong JSON structure")
    if not dataset["players"] or not dataset["events"]:
        raise ValueError("Real players/events are required; no mock substitution")
    sources = {}
    for filename in MODULE_FILES:
        path = ROOT / "src/js" / filename
        code = path.read_text(encoding="utf-8-sig")
        def asset(match):
            target = (path.parent / match[2]).resolve()
            if not target.is_relative_to(ROOT):
                raise ValueError("Asset escapes the repository")
            return json.dumps(data_url(target))
        sources[path.relative_to(ROOT).as_posix()] = ASSET.sub(asset, code)
    license_path = ROOT / "docs/data_source/StatsBomb-LICENSE.pdf"
    d3_license = (ROOT / "src/js/vendor/D3-LICENSE").read_text(encoding="utf-8")
    payload = embedded_json({"dataset": dataset, "sources": sources})
    page = (ROOT / "src/index.html").read_text(encoding="utf-8-sig")
    page = page.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-offline>')
    page = page.replace('<link rel="stylesheet" href="./css/style.css">', '<style>' + (ROOT / "src/css/style.css").read_text(encoding="utf-8") + '</style>')
    page = page.replace('<script type="module" src="./js/main.js"></script>', '')
    page = page.replace('./assets/statsbomb-logo.png', data_url(ROOT / "src/assets/statsbomb-logo.png"))
    page = page.replace('请启用 JavaScript，并通过本地 HTTP 服务打开页面。', '请启用 JavaScript，并使用现代 Chrome 或 Edge 直接打开此离线 HTML。')
    page = page.replace('../docs/INTEGRATION_D.md', '#offline-help')
    page = page.replace('模块 D 与项目集成</a>', '离线使用说明与许可</a>')
    page = page.replace('<span class="app-edition">', '<span class="app-edition">离线版 / ')
    policy = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'"
    page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">')
    help_section = '<details class="app-card" id="offline-help"><summary>离线使用说明与许可</summary><p>此文件已包含真实比赛数据、全部模块、D3、样式与标志。无需 Python、服务器或网络。修改源码/数据后需重新生成此文件，浏览器操作不会改写源数据。</p><p>外部数据来源链接仅在主动点击时访问网络。此包含逐事件数据，仅供本地演示；分享或公开发布前请核对来源许可。</p><p><a download="StatsBomb-LICENSE.pdf" href="' + data_url(license_path) + '">保存 StatsBomb 官方许可</a></p><details><summary>D3 许可证</summary><pre style="white-space:pre-wrap">' + html.escape(d3_license) + '</pre></details></details>'
    page = page.replace('</main>', help_section + '</main>')
    page = page.replace('</body>', '<script type="application/json" id="offline-payload">' + payload + '</script>\n<script type="module">' + BOOTSTRAP + '</script>\n</body>')
    if 'data-offline' not in page or 'src="./js/' in page or 'href="./css/' in page:
        raise ValueError("Unexpected index.html structure; cannot safely package")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(page, encoding="utf-8")
    temporary.replace(output)
    return {"match_id": dataset["stats"].get("match_id"), "players": len(dataset["players"]), "events": len(dataset["events"]),
            "collaboration_edges": len(dataset["collaborationEdges"]), "competition_edges": len(dataset["competitionEdges"]),
            "html_bytes": output.stat().st_size, "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/offline/Football-HyperGraph-Explorer.html")
    parser.add_argument("--zip", type=Path, default=ROOT / "output/Football-HyperGraph-Explorer-offline.zip")
    args = parser.parse_args(argv)
    if args.output.suffix.lower() != ".html" or args.zip.suffix.lower() != ".zip":
        parser.error("Output paths must end with .html and .zip")
    # Do not let a build accidentally overwrite source files or data.
    for target in (args.output.resolve(), args.zip.resolve()):
        if any(target.is_relative_to(ROOT / folder) for folder in ("src", "scripts", "data", "docs", "tests")):
            parser.error("Choose a generated output directory, such as output/")
    try:
        report = build(args.output)
        args.zip.parent.mkdir(parents=True, exist_ok=True)
        zip_temp = args.zip.with_suffix(".zip.tmp")
        with ZipFile(zip_temp, "w", ZIP_DEFLATED) as package:
            package.write(args.output, "index.html")
            package.write(ROOT / "docs/data_source/StatsBomb-LICENSE.pdf", "StatsBomb-LICENSE.pdf")
            package.write(ROOT / "docs/data_source/StatsBomb-README.md", "StatsBomb-README.md")
            package.write(ROOT / "src/js/vendor/D3-LICENSE", "D3-LICENSE.txt")
            package.writestr("README.txt", "Football HyperGraph Explorer 离线演示\n\n解压后用 Chrome 或 Edge 双击 index.html，无需服务器、Python、网络或其他文件。\n保留全部 A/B/C/D 功能与真实数据，点球大战不计入个人指标。\n此文件是构建时快照，源码或数据修改后需重新生成。\n数据来自 StatsBomb Open Data，match 3869685，固定版本 4b73468fc5b0f1950f9f66fada70ad3a4f9327cb。\n此包含逐事件数据，公开发布/转发前需核对所附官方许可，不能因公开可下载而假定可以任意再分发。\n")
        zip_temp.replace(args.zip)
        print(json.dumps({"status": "ok", "html": str(args.output), "zip": str(args.zip), **report}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError) as error:
        print(f"Offline build failed: {error}\nRun python scripts/prepare_data.py first; do not use mock data as a substitute.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
