"""i18n gate — run this in the plugin directory before pack_plugin / create_plugin
/ submit_version.

FAIL blocks the upload: an incomplete `i18n` block, a half-translated localized
title (the host refuses those), a display string carrying markup, entities,
control characters or a literal backslash escape, or two copy tables that
disagree on keys. REVIEW is what the host tolerates but the catalog should fix.
"""
import json
import pathlib
import re
import sys

BAD, REVIEW = [], []
ROOT = pathlib.Path(".")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u2028\u2029\ufeff\u200b-\u200f\u2060]")
ENTITY = re.compile(r"&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+);")
TAG = re.compile(r"</?[a-zA-Z][^>]*>")
DOUBLE = re.compile(r"\\[nrt\"]")
LOCALES = {"en", "zh", "zh-CN"}
LOCALE = r"(en|en[-_]US|zh|zh-CN|zh[-_]Hans|zh_CN)"
SKIP_DIRS = {".git", "node_modules", "test", "tests", "docs", "examples"}
SUFFIXES = {".js", ".mjs", ".cjs", ".ts", ".html", ".json", ".vue", ".svelte"}


def fail(message):
    print(f"i18n gate: FAIL {message}")
    sys.exit(1)


try:
    MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
except Exception as exc:  # noqa: BLE001
    fail(f"manifest.json is unreadable — {exc}")
if not isinstance(MANIFEST, dict):
    fail("manifest.json must be a JSON object")


def scan(path, value, escaped=False):
    """escaped=True means the text still carries JS source escapes."""
    if not isinstance(value, str):
        return
    if escaped:
        value = value.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "")
        value = value.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")
    if "\n" in value or "\t" in value:
        REVIEW.append(f"{path}: line break or tab in display text — keep it one line, let the UI wrap")
    if CONTROL.search(value):
        BAD.append(f"{path}: control / zero-width / line-separator character")
    if ENTITY.search(value):
        BAD.append(f"{path}: HTML entity — the UI shows it literally, use raw text")
    if TAG.search(value):
        BAD.append(f"{path}: HTML tag in display text")
    if not escaped and DOUBLE.search(value):
        BAD.append(f'{path}: literal backslash escape in the value (double escaping)')
    if "<" in value or ">" in value:
        REVIEW.append(f"{path}: raw < or > — reword, or check the card after publish")


# 1. The i18n block itself --------------------------------------------------
i18n = MANIFEST.get("i18n")
if not isinstance(i18n, dict):
    BAD.append("i18n: missing — the marketplace and the host both read it")
    i18n = {}
for locale in ("en", "zh-CN"):
    entry = i18n.get(locale) if isinstance(i18n.get(locale), dict) else {}
    if not isinstance(i18n.get(locale), dict):
        BAD.append(f"i18n.{locale}: missing locale block")
    for field in ("name", "description", "safetyNotes"):
        if not (isinstance(entry.get(field), str) and entry[field].strip()):
            BAD.append(f"i18n.{locale}.{field}: missing or empty")

# 2. Localized slots the host refuses when half-translated ------------------
raw_contributes = MANIFEST.get("contributes")
contributes = raw_contributes if isinstance(raw_contributes, dict) else {}
raw_views = contributes.get("views")
views = [view for view in raw_views if isinstance(view, dict)] if isinstance(raw_views, list) else []
ui = MANIFEST.get("ui") if isinstance(MANIFEST.get("ui"), dict) else {}
slots = [("manifest.ui.title", ui.get("title"))]
for index, view in enumerate(views):
    slots.append((f"contributes.views[{index}].title", view.get("title")))
raw_sources = contributes.get("sessionSources")
for index, source in enumerate(raw_sources if isinstance(raw_sources, list) else []):
    if isinstance(source, dict):
        slots.append((f"contributes.sessionSources[{index}].label", source.get("label")))
scenic = contributes.get("scenicThemes") if isinstance(contributes.get("scenicThemes"), dict) else {}
if scenic:
    slots.append(("contributes.scenicThemes.label", scenic.get("label")))
    slots.append(("contributes.scenicThemes.description", scenic.get("description")))

for field, value in slots:
    if value is None:
        continue
    if isinstance(value, str):
        if value.strip():
            REVIEW.append(f"{field}: plain string — use {{ en, zh-CN }} to follow the app language")
        else:
            BAD.append(f"{field}: empty")
        continue
    if not isinstance(value, dict):
        BAD.append(f"{field}: must be a string or {{ en, zh-CN }}")
        continue
    for locale in ("en", "zh-CN"):
        if not (isinstance(value.get(locale), str) and value[locale].strip()):
            BAD.append(f"{field}.{locale}: required — a half-translated title falls back silently")

# 3. Display safety of every catalog string --------------------------------
for locale, entry in (i18n.items() if isinstance(i18n, dict) else []):
    if isinstance(entry, dict):
        for field, value in entry.items():
            scan(f"i18n.{locale}.{field}", value)
for field in ("name", "description", "safetyNotes"):
    scan(field, MANIFEST.get(field))
for field, value in slots:
    if isinstance(value, dict):
        scan(f"{field}.en", value.get("en"))
        scan(f"{field}.zh-CN", value.get("zh-CN"))
raw_commands = contributes.get("commands")
for index, command in enumerate(raw_commands if isinstance(raw_commands, list) else []):
    if isinstance(command, dict):
        scan(f"contributes.commands[{index}].title", command.get("title"))
        if isinstance(command.get("title"), str):
            REVIEW.append(f"contributes.commands[{index}].title: plain string — localize it")

# 4. The panel's own copy table --------------------------------------------
TABLE_LINE = re.compile(rf"^([ \t]*)(?:\"|')?{LOCALE}(?:\"|')?\s*:\s*\{{")
PAIR = re.compile(
    r"([A-Za-z_$][\w$]*|\"[^\"]+\"|'[^']+')\s*:\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)"
)
STRINGY = re.compile(r"\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`")
DANGLING = re.compile(r"^[ \t]+([A-Za-z_$][\w$]*|\"[^\"]+\"|'[^']+')\s*:\s*$")
INLINE = re.compile(rf"(?<![\w$])(?:\"|')?{LOCALE}(?:\"|')?\s*:\s*\{{")


def normal(raw):
    return "zh-CN" if raw.lower().startswith("zh") else "en"


def unescape(text):
    text = text.replace("\\n", " ").replace("\\t", " ").replace("\\r", "")
    text = text.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")
    return re.sub(r"\$\{[^}]*\}", "", text)


def probe(row, start, begin=0):
    """Depth and string-literal membership at each position of one line."""
    spans = [(item.start(), item.end()) for item in STRINGY.finditer(row)]
    quoted = [any(low < pos < high for low, high in spans) for pos in range(len(row))]

    def at(position):
        depth = start
        for index in range(begin, min(position, len(row))):
            if quoted[index]:
                continue
            depth += {"{": 1, "}": -1}.get(row[index], 0)
        return depth, quoted[position] if position < len(row) else False

    return at


def braces(row):
    clean = STRINGY.sub("", row)
    return clean.count("{") - clean.count("}")


def copy_tables(text, unresolved):
    """Locale-keyed copy tables: one entry per line, or inline on the key's line."""
    lines = text.splitlines()
    tables = []
    for index, line in enumerate(lines):
        match = TABLE_LINE.match(line)
        if not match:
            continue
        locale, indent = normal(match.group(2)), len(match.group(1))
        entries, pending, depth = {}, None, 1
        at = probe(line, depth, match.end())
        for item in PAIR.finditer(line, match.end()):
            level, in_string = at(item.start())
            if level == 1 and not in_string:
                entries.setdefault(item.group(1).strip("\"'"), item.group(2))
        for offset in range(index + 1, len(lines)):
            row = lines[offset]
            if depth <= 1 and row.strip() and len(row) - len(row.lstrip()) <= indent:
                break
            at = probe(row, depth)
            if pending:
                tail = re.match(
                    r"^\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*([+,]?)\s*$",
                    row,
                )
                if tail:
                    entries[pending] = entries.get(pending, "") + tail.group(1)
                    if tail.group(2) != "+":
                        pending = None
                    depth += braces(row)
                    if depth <= 0:
                        break
                    continue
                if row.strip():
                    unresolved.append(f"{locale} key '{pending}' near line {offset + 1} has no readable value")
                pending = None
            if depth <= 1:
                for item in PAIR.finditer(row):
                    level, in_string = at(item.start())
                    if level == 1 and not in_string:
                        entries.setdefault(item.group(1).strip("\"'"), item.group(2))
                dangling = DANGLING.match(row)
                if dangling:
                    pending = dangling.group(1).strip("\"'")
                    entries.setdefault(pending, "")
            depth += braces(row)
            if depth <= 0:
                break
        if pending:
            unresolved.append(f"{locale} key '{pending}' ran to the end of its table without a value")
        if entries:
            tables.append((locale, entries))
    return tables


def holders(value):
    return sorted(re.findall(r"\{[A-Za-z0-9_]+\}", value or ""))


dictionary, seen, report = set(), set(), {}
for path in sorted(ROOT.glob("**/*")):
    if path.suffix not in SUFFIXES or not path.is_file():
        continue
    if any(part in SKIP_DIRS for part in path.parts) or path.name == "manifest.json":
        continue
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        continue
    seen.update(normal(match.group(1)) for match in INLINE.finditer(text))
    if len(text) > 512_000 or len(text) / max(1, len(text.splitlines())) >= 400:
        continue  # a bundle or a build artifact: structure checks only, no content noise
    unresolved = []
    tables = copy_tables(text, unresolved)
    if not tables and {"en", "zh-CN"} <= {normal(match.group(1)) for match in INLINE.finditer(text)}:
        REVIEW.append(f"{path}: locale tables here were not parsed — compare the keys by hand")
    for note in unresolved:
        REVIEW.append(f"{path}: {note}")
    for locale, entries in tables:
        report.setdefault(str(path), {}).setdefault(locale, {}).update(entries)
        values = [value for value in entries.values() if value]
        dictionary.update(unescape(value.strip("\"'`")) for value in values)
        for key, value in entries.items():
            scan(f"{path}:{key}", unescape(value.strip("\"'`")), escaped=True)

placeholder_notes = set()
for path, tables in report.items():
    if not {"en", "zh-CN"} <= set(tables):
        continue
    english, chinese = tables["en"], tables["zh-CN"]
    only_en = sorted(key for key in set(english) - set(chinese) if english[key])
    only_cn = sorted(key for key in set(chinese) - set(english) if chinese[key])
    if only_en:
        BAD.append(f"{path}: copy missing in zh-CN -> {', '.join(only_en[:6])}")
    if only_cn:
        BAD.append(f"{path}: copy missing in en -> {', '.join(only_cn[:6])}")
    for key in set(english) & set(chinese):
        left, right = holders(english[key]), holders(chinese[key])
        if left != right and (left or right):
            note = f"{key}: en {'+'.join(left) or 'none'} vs zh-CN {'+'.join(right) or 'none'}"
            if note in placeholder_notes:
                continue
            placeholder_notes.add(note)
            REVIEW.append(f"{path}: placeholder differs — {note} (translate it, never rename it)")

panels = [ui.get("panel")] + [view.get("entry") for view in views]
panels = [panel for panel in panels if isinstance(panel, str) and panel]
if panels and not {"en", "zh-CN"} <= seen:
    for entry in panels:
        if entry.startswith("/") or ".." in entry.split("/"):
            BAD.append(f"panel entry {entry}: must be a relative path inside the plugin")
            continue
        try:
            raw = (ROOT / entry).read_text(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            continue
        stripped = re.sub(r"<(script|style)\b.*?</\1>", "", raw, flags=re.S | re.I)
        nodes = [" ".join(node.split()) for node in re.findall(r">([^<>]+)<", stripped) if node.strip()]
        nodes += [" ".join(node.split()) for node in re.findall(r"(?:title|placeholder|aria-label|alt)=\"([^\"]+)\"", stripped)]
        chinese = [node for node in nodes if re.search(r"[\u4e00-\u9fff]", node)]
        english = [node for node in nodes if re.search(r"[A-Za-z]{3,}", node) and node not in chinese]
        phrases = [node for node in english if len(node) >= 8 and " " in node]
        if chinese and phrases:
            REVIEW.append(f"{entry}: bilingual copy written inline, no en + zh-CN table — keep both in sync by hand")
        elif len(chinese) + len(english) >= 3:
            BAD.append(f"{entry}: copy is one language with no en + zh-CN table — it cannot follow the app language")
        else:
            REVIEW.append(f"{entry}: copy comes from a script or bundle — confirm its en + zh-CN table by hand")

for path in sorted(ROOT.glob("**/*.html")):
    if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
        continue
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        continue
    stripped = re.sub(r"<(script|style)\b.*?</\1>", "", raw, flags=re.S | re.I)
    for node in re.findall(r">([^<>]+)<", stripped):
        node = " ".join(node.split())
        if len(node) < 2 or node in dictionary or not re.search(r"[A-Za-z\u4e00-\u9fff]", node):
            continue
        REVIEW.append(f"{path}: visible text outside the copy table -> {node[:48]}")

print(f"i18n gate: {len(BAD)} fail, {len(REVIEW)} review")
for line in BAD:
    print(f"  FAIL {line}")
grouped = {}
for line in REVIEW:
    where, _, note = line.partition(": ")
    grouped.setdefault(where, []).append(note)
for where, notes in grouped.items():
    for note in notes[:4]:
        print(f"  REVIEW {where}: {note}")
    if len(notes) > 4:
        print(f"  REVIEW {where}: … +{len(notes) - 4} more")
sys.exit(1 if BAD else 0)
