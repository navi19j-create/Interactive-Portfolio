"""Check the static site under a GitHub Pages project prefix, including filename case."""

from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import unquote, urljoin, urlsplit

root = Path(__file__).resolve().parents[1] / "dist"
prefix = "/Interactive-Portfolio/"
origin = "https://pages.example"
files = {file.relative_to(root).as_posix() for file in root.rglob("*") if file.is_file()}
errors = []


def check(owner, ref):
    if not ref or ref.startswith(("#", "data:", "blob:", "mailto:", "tel:")):
        return
    target = urlsplit(urljoin(origin + prefix + owner, ref))
    if target.netloc != "pages.example":
        return
    path = unquote(target.path)
    local = path[len(prefix):] + ("index.html" if path.endswith("/") else "")
    if not path.startswith(prefix) or local not in files:
        errors.append(f"{owner}: missing {ref}")


class Links(HTMLParser):
    def __init__(self, owner):
        super().__init__()
        self.owner = owner

    def handle_starttag(self, tag, attrs):
        for name, ref in attrs:
            if name in ("src", "href", "poster"):
                check(self.owner, ref)


for name in sorted(files):
    if name.endswith(".html"):
        Links(name).feed((root / name).read_text(encoding="utf-8"))
    elif name.endswith(".css"):
        for ref in re.findall(r"""url\(\s*['"]?([^)'"]+)['"]?\s*\)""", (root / name).read_text(encoding="utf-8")):
            check(name, ref.strip())

if "index.html" not in files:
    errors.append("Missing portfolio homepage")
if errors:
    raise SystemExit("\n".join(errors))
print("Portfolio page links, images, scripts, styles and fonts passed.")
