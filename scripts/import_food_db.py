"""Convert the MFDS food database workbooks into the app's catalog data.

    python3 scripts/import_food_db.py

The workbooks live in "docs/FOOD DATABASE/" and are NOT committed: the
가공식품 one is 109MB, past GitHub's 100MB file limit. Only the generated
files are committed.

Outputs:
  js/foods-kr.js           음식DB          — bundled, loaded with the page
  js/foods-supplement.js   건강기능식품DB   — bundled, small
  data/foods-processed.json 가공식품DB     — fetched on demand, far too big to bundle

Values are copied from the source columns. A serving is scaled from the
published basis by that row's own serving weight; nothing is estimated.
See docs/FOOD_DATA.md.
"""

import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "docs" / "FOOD DATABASE"

# Column layouts differ between workbooks: 건강기능식품 has an extra 유형명 column.
# 7/9/11/13 are 대분류명 / 대표식품명 / 중분류명 / 소분류명. All four go into the
# search keywords: a product called "카스 프레시" is only findable as 맥주
# through its category names.
CATEGORY_COLUMNS = [7, 9, 11, 13]
DISH_COLUMNS = {"name": 1, "basis": 16, "kcal": 17, "protein": 19, "fat": 20, "carbs": 22}
SUPPLEMENT_COLUMNS = {"name": 1, "basis": 17, "kcal": 18, "protein": 20, "fat": 21, "carbs": 23}

SOURCES = [
    {
        "file": "20250408_음식DB.xlsx",
        "target": ROOT / "js" / "foods-kr.js",
        "export": "KOREAN_FOODS",
        "prefix": "mfds",
        "source": "식품의약품안전처 식품영양성분DB · 음식DB 2025-04-08",
        "columns": DISH_COLUMNS,
        "serving": 153,      # 식품중량
        "serving_label": "1인분",
        "basis_is_serving": False,
    },
    {
        "file": "20251230_건강기능식품DB_4380건 (5).xlsx",
        "target": ROOT / "js" / "foods-supplement.js",
        "export": "SUPPLEMENT_FOODS",
        "prefix": "mfdshf",
        "source": "식품의약품안전처 식품영양성분DB · 건강기능식품DB 2025-12-30",
        "columns": SUPPLEMENT_COLUMNS,
        "serving": 156,      # 1회분량 (e.g. "1정")
        "serving_label": None,
        # Every row's 기준량 equals its 1회분량 중량/부피, so the published
        # figures already describe one serving and must not be rescaled.
        "basis_is_serving": True,
    },
    {
        "file": "20260626_가공식품DB_298288건.xlsx",
        "target": ROOT / "data" / "foods-processed.json",
        "export": None,
        "prefix": "mfdsp",
        "source": "식품의약품안전처 식품영양성분DB · 가공식품DB 2026-06-26",
        "columns": DISH_COLUMNS,
        "serving": 152,      # 1회 섭취참고량
        "serving_label": "1회분",
        "basis_is_serving": False,
    },
]

AMOUNT = re.compile(r"^([0-9]+(?:\.[0-9]+)?)\s*(g|ml|mg)$", re.IGNORECASE)
BLANK = ("", "-", "해당없음", "N/A", "None")


def number(value):
    if value is None:
        return None
    text = str(value).strip()
    if text in BLANK:
        return None
    try:
        return round(float(text), 3)
    except ValueError:
        return None


def clean(text):
    # Source rows carry stray byte-order marks and a "？" placeholder where the
    # exporter lost a character; neither belongs in a food name.
    return text.replace("\ufeff", "").lstrip("？\ufeff ").strip()


def keywords(row):
    seen, parts = set(), []
    for index in CATEGORY_COLUMNS:
        value = clean(str(row[index] or ""))
        if not value or value in BLANK or value in seen:
            continue
        seen.add(value)
        parts.append(value)
    return " ".join(parts)


def label(name):
    # Source names read "피자_슈퍼 디럭스": the underscore separates the dish
    # group from the specific product.
    return name.replace("_", " · ", 1).strip()


def convert(spec):
    path = DB / spec["file"]
    if not path.exists():
        print(f"  건너뜀 · 워크북 없음: {path.name}")
        return None
    col = spec["columns"]
    sheet = openpyxl.load_workbook(path, read_only=True).active

    items, seen, skipped = [], set(), 0
    for row in sheet.iter_rows(min_row=2, values_only=True):
        name = clean(str(row[col["name"]] or ""))
        kcal = number(row[col["kcal"]])
        if not name or kcal is None or name in seen:
            skipped += 1
            continue
        seen.add(name)

        macros = [number(row[col[key]]) for key in ("protein", "carbs", "fat")]
        group = keywords(row)
        basis = AMOUNT.match(str(row[col["basis"]] or "").strip())
        serving = str(row[spec["serving"]] or "").strip()

        if spec["basis_is_serving"]:
            unit = str(row[col["basis"]] or "").strip()
            name = f"{label(name)} · {serving or '1회분'} {unit}".strip()
            items.append([name, kcal, *macros, 1, "개", group])
            continue

        measure = AMOUNT.match(serving)
        basis_amount = float(basis.group(1)) if basis else 100
        if measure and basis_amount:
            grams = float(measure.group(1))
            scale = grams / basis_amount
            values = [round(kcal * scale, 2)] + [
                None if m is None else round(m * scale, 2) for m in macros
            ]
            name = f"{label(name)} · {spec['serving_label']} {measure.group(1)}{measure.group(2)}"
            items.append([name, *values, 1, "개", group])
        else:
            unit = basis.group(2).lower() if basis else "g"
            items.append([label(name), kcal, *macros, 100, unit, group])

    return items, skipped


def write_module(spec, items):
    payload = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    spec["target"].parent.mkdir(parents=True, exist_ok=True)
    spec["target"].write_text(
        "// Generated by scripts/import_food_db.py. Do not edit by hand.\n"
        f"// {spec['source']}\n"
        "// [name, kcal, protein, carbs, fat, baseAmount, baseUnit, group]\n"
        f"const rows = {payload};\n\n"
        f"export const {spec['export']} = rows.map(\n"
        "  ([name, kcal, protein, carbs, fat, baseAmount, baseUnit, group], index) =>\n"
        "    Object.freeze({\n"
        f"      id: `{spec['prefix']}-${{index}}`,\n"
        "      name,\n      kcal,\n      protein,\n      carbs,\n      fat,\n"
        "      keywords: group,\n      baseAmount,\n      baseUnit,\n"
        f'      source: "{spec["source"]}",\n'
        '      sourceUrl: "https://various.foodsafetykorea.go.kr/nutrient/",\n'
        "    }),\n"
        ");\n",
        encoding="utf-8",
    )


def write_json(spec, items):
    spec["target"].parent.mkdir(parents=True, exist_ok=True)
    spec["target"].write_text(
        json.dumps(
            {
                "prefix": spec["prefix"],
                "source": spec["source"],
                "sourceUrl": "https://various.foodsafetykorea.go.kr/nutrient/",
                "fields": ["name", "kcal", "protein", "carbs", "fat", "baseAmount", "baseUnit", "group"],
                "rows": items,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def main():
    if not DB.exists():
        sys.exit(f"워크북 폴더를 찾을 수 없습니다: {DB}")
    for spec in SOURCES:
        print(f"· {spec['file']}")
        result = convert(spec)
        if result is None:
            continue
        items, skipped = result
        if spec["export"]:
            write_module(spec, items)
        else:
            write_json(spec, items)
        size = spec["target"].stat().st_size
        print(f"  {len(items):,}종 · 건너뜀 {skipped:,} · {size:,} bytes → {spec['target'].relative_to(ROOT)}")


if __name__ == "__main__":
    main()
