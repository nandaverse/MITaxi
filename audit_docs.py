#!/usr/bin/env python3
"""Documentation audit: PDFs vs site JSON content."""
import json
import os
import re
from pathlib import Path
from collections import defaultdict

import fitz  # pymupdf

ROOT = Path(__file__).parent
TM_DOCS = ROOT / "TM-Documents"
SITE = ROOT / "site"
CONTENT = SITE / "content"
ASSETS = SITE / "assets"

PDF_MAP = {
    "driver_mitaxi": "MiTaxiApp_Driver_Document.docx .pdf",
    "driver_platform": "TaxiMobility_Driver_Application.pdf",
    "passenger_mitaxi": "MiTaxiApp_Passenger_Document.docx.pdf",
    "passenger_platform": "TaxiMobility_Customer_Application.pdf",
    "admin": "TaxiMobility_Admin Panel_V 90 (2)_260706_215135.pdf",
    "dispatcher": "TaxiMobility_Dispatch.pdf",
    "vendor": "TaxiMobility_Vendors_Manual.pdf",
    "combined": "TaxiMobility-Dispatch, Admin, Fleetmanagement.pdf",
}

JSON_MAP = {
    "driver": "driver.json",
    "passenger": "passenger.json",
    "admin": "admin.json",
    "dispatcher": "dispatcher.json",
    "vendor": "vendor.json",
}

# PDF key -> JSON guide for coverage comparison
PDF_TO_JSON = {
    "driver_mitaxi": "driver",
    "driver_platform": "driver",
    "passenger_mitaxi": "passenger",
    "passenger_platform": "passenger",
    "admin": "admin",
    "dispatcher": "dispatcher",
    "vendor": "vendor",
}


def extract_pdf_structure(pdf_path: Path) -> dict:
    """Extract headings, page count, and sample text from PDF."""
    doc = fitz.open(pdf_path)
    pages = doc.page_count
    all_lines = []
    headings = []
    numbered_headings = []

    # Patterns for section headings
    num_pat = re.compile(
        r"^(\d+(?:\.\d+)*)\s+(.+?)\s*$"
    )
    # Also match lines that look like TOC entries
    toc_pat = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+?)(?:\s+\d+)?\s*$")

    for pi in range(pages):
        text = doc[pi].get_text("text")
        for line in text.splitlines():
            line = line.strip()
            if not line or len(line) < 3:
                continue
            all_lines.append((pi + 1, line))
            m = num_pat.match(line)
            if m and len(m.group(2)) < 120:
                num, title = m.group(1), m.group(2).strip()
                # Filter noise: page numbers, dates, etc.
                if re.match(r"^\d{1,2}$", title):
                    continue
                if title.lower() in ("page", "pages"):
                    continue
                entry = {"number": num, "title": title, "page": pi + 1}
                headings.append(entry)
                if "." in num or int(num) <= 20:
                    numbered_headings.append(entry)

    # Deduplicate headings by number+title
    seen = set()
    unique_headings = []
    for h in headings:
        key = (h["number"], h["title"].lower())
        if key not in seen:
            seen.add(key)
            unique_headings.append(h)

    # Get first/last page text snippets
    first_page = doc[0].get_text("text")[:500] if pages else ""
    last_page = doc[pages - 1].get_text("text")[-800:] if pages else ""

    doc.close()
    return {
        "pages": pages,
        "headings": unique_headings,
        "numbered_headings": unique_headings,
        "first_page_snippet": first_page,
        "last_page_snippet": last_page,
        "total_lines": len(all_lines),
    }


def walk_json_sections(sections, depth=0, parent_path=""):
    """Yield flat list of section info from JSON tree."""
    results = []
    for s in sections:
        path = f"{parent_path}/{s['id']}" if parent_path else s["id"]
        title_en = s.get("title", {}).get("en", "")
        title_es = s.get("title", {}).get("es", "")
        content = s.get("content", {})
        en = (content.get("en") or "").strip()
        es = (content.get("es") or "").strip()
        children = s.get("children", [])
        images = re.findall(r"!\[[^\]]*\]\((assets/[^)]+)\)", en + es)

        results.append({
            "id": s["id"],
            "number": s.get("number"),
            "title_en": title_en,
            "title_es": title_es,
            "depth": depth,
            "path": path,
            "children_count": len(children),
            "en_len": len(en),
            "es_len": len(es),
            "en_empty": len(en) == 0,
            "es_empty": len(es) == 0,
            "has_placeholder": any(
                p in (en + es).lower()
                for p in [
                    "source content was not available",
                    "missing content",
                    "content for this section",
                    "not available in the source",
                    "todo",
                ]
            ),
            "images": images,
        })
        if children:
            results.extend(walk_json_sections(children, depth + 1, path))
    return results


def normalize_title(t: str) -> str:
    t = t.lower().strip()
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t)
    # Remove common suffixes
    for w in ["module", "screen", "panel", "guide", "app", "application"]:
        t = re.sub(rf"\b{w}\b", "", t)
    return re.sub(r"\s+", " ", t).strip()


def fuzzy_match(pdf_title: str, json_titles: list) -> tuple:
    """Return best match score and matched json title."""
    pn = normalize_title(pdf_title)
    best_score = 0
    best_match = None
    for jt in json_titles:
        jn = normalize_title(jt)
        if pn == jn:
            return 1.0, jt
        if pn in jn or jn in pn:
            score = min(len(pn), len(jn)) / max(len(pn), len(jn), 1)
            if score > best_score:
                best_score = score
                best_match = jt
        # Word overlap
        pw = set(pn.split())
        jw = set(jn.split())
        if pw and jw:
            overlap = len(pw & jw) / len(pw | jw)
            if overlap > best_score:
                best_score = overlap
                best_match = jt
    return best_score, best_match


def check_images(guide: str, sections_flat: list) -> dict:
    asset_dir = ASSETS / guide
    manifest_path = asset_dir / "manifest.json"
    manifest_files = set()
    if manifest_path.exists():
        with open(manifest_path) as f:
            manifest = json.load(f)
        if isinstance(manifest, list):
            manifest_files = set(manifest)
        elif isinstance(manifest, dict):
            manifest_files = set(manifest.get("files", manifest.get("images", [])))

    disk_files = set()
    if asset_dir.exists():
        disk_files = {f.name for f in asset_dir.iterdir() if f.suffix.lower() in (".jpeg", ".jpg", ".png", ".webp")}

    referenced = set()
    broken = []
    for s in sections_flat:
        for img in s["images"]:
            # img like assets/driver/p004-1.jpeg
            fname = Path(img).name
            referenced.add(fname)
            full = SITE / img.replace("assets/", "assets/")
            if not full.exists():
                broken.append({"section": s["path"], "image": img, "reason": "file missing"})

    unreferenced_on_disk = disk_files - referenced
    referenced_not_on_disk = referenced - disk_files
    manifest_missing = referenced - manifest_files if manifest_files else set()
    manifest_orphan = manifest_files - disk_files if manifest_files else set()

    return {
        "referenced_count": len(referenced),
        "disk_count": len(disk_files),
        "manifest_count": len(manifest_files),
        "broken_refs": broken,
        "referenced_not_on_disk": sorted(referenced_not_on_disk),
        "unreferenced_on_disk": sorted(unreferenced_on_disk)[:30],
        "unreferenced_on_disk_total": len(unreferenced_on_disk),
        "in_manifest_not_disk": sorted(manifest_orphan)[:20],
        "referenced_not_in_manifest": sorted(manifest_missing)[:20],
    }


def compare_mitaxi_vs_platform(mitaxi_headings, platform_headings):
    """Find MiTaxi-only topics vs platform."""
    mitaxi_titles = {normalize_title(h["title"]) for h in mitaxi_headings}
    platform_titles = {normalize_title(h["title"]) for h in platform_headings}

    mitaxi_only = []
    for h in mitaxi_headings:
        nt = normalize_title(h["title"])
        if nt not in platform_titles:
            # Check fuzzy
            found = False
            for pt in platform_titles:
                if nt in pt or pt in nt:
                    found = True
                    break
                pw = set(nt.split())
                ptw = set(pt.split())
                if pw and ptw and len(pw & ptw) / len(pw | ptw) > 0.6:
                    found = True
                    break
            if not found:
                mitaxi_only.append(h)

    platform_only = []
    for h in platform_headings:
        nt = normalize_title(h["title"])
        if nt not in mitaxi_titles:
            found = False
            for mt in mitaxi_titles:
                if nt in mt or mt in nt:
                    found = True
                    break
                pw = set(nt.split())
                mtw = set(mt.split())
                if pw and mtw and len(pw & mtw) / len(pw | mtw) > 0.6:
                    found = True
                    break
            if not found:
                platform_only.append(h)

    return mitaxi_only, platform_only


def assess_guide_status(sections_flat, pdf_matched_pct, empty_parents, bilingual_gaps, broken_images):
    if broken_images:
        img_status = "fail"
    elif empty_parents > 5:
        img_status = "partial"
    else:
        img_status = "pass"

    if pdf_matched_pct >= 0.85 and bilingual_gaps == 0 and not broken_images:
        return "pass"
    if pdf_matched_pct >= 0.6 or bilingual_gaps < 5:
        return "partial"
    return "fail"


def main():
    report = {"pdfs": {}, "guides": {}, "comparisons": {}, "mitaxi_features": {}}

    # Extract all PDFs
    for key, fname in PDF_MAP.items():
        path = TM_DOCS / fname
        if path.exists():
            report["pdfs"][key] = extract_pdf_structure(path)
            report["pdfs"][key]["file"] = fname
        else:
            report["pdfs"][key] = {"error": f"not found: {fname}"}

    # Parse all JSON guides
    json_data = {}
    for guide, fname in JSON_MAP.items():
        path = CONTENT / fname
        with open(path) as f:
            data = json.load(f)
        flat = walk_json_sections(data["sections"])
        json_data[guide] = {"raw": data, "flat": flat}
        report["guides"][guide] = {
            "top_level_sections": len(data["sections"]),
            "total_sections": len(flat),
            "sections": [
                {
                    "id": s["id"],
                    "number": s["number"],
                    "title_en": s["title_en"],
                    "title_es": s["title_es"],
                    "children_count": s["children_count"],
                    "en_empty": s["en_empty"],
                    "es_empty": s["es_empty"],
                    "has_placeholder": s["has_placeholder"],
                    "depth": s["depth"],
                }
                for s in flat
            ],
        }

    # Coverage: PDF sections vs JSON
    for pdf_key, guide in PDF_TO_JSON.items():
        if pdf_key not in report["pdfs"] or "error" in report["pdfs"][pdf_key]:
            continue
        pdf_headings = report["pdfs"][pdf_key]["numbered_headings"]
        json_titles = [s["title_en"] for s in json_data[guide]["flat"]]
        json_by_num = {
            s["number"]: s["title_en"]
            for s in json_data[guide]["flat"]
            if s["number"]
        }

        matched = []
        missing = []
        for h in pdf_headings:
            num = h["number"]
            title = h["title"]
            score, match = fuzzy_match(title, json_titles)
            num_match = json_by_num.get(num)
            if num_match and fuzzy_match(title, [num_match])[0] >= 0.5:
                matched.append({**h, "json_match": num_match, "via": "number"})
            elif score >= 0.55:
                matched.append({**h, "json_match": match, "via": "title", "score": score})
            else:
                missing.append(h)

        pct = len(matched) / len(pdf_headings) if pdf_headings else 1.0
        report["comparisons"][pdf_key] = {
            "json_guide": guide,
            "pdf_sections": len(pdf_headings),
            "matched": len(matched),
            "missing": len(missing),
            "match_pct": round(pct, 3),
            "missing_sections": missing[:40],
            "matched_samples": matched[:15],
        }

    # MiTaxi vs Platform comparison
    for role in ["driver", "passenger"]:
        mitaxi_key = f"{role}_mitaxi"
        platform_key = f"{role}_platform"
        if mitaxi_key in report["pdfs"] and platform_key in report["pdfs"]:
            mitaxi_only, platform_only = compare_mitaxi_vs_platform(
                report["pdfs"][mitaxi_key]["numbered_headings"],
                report["pdfs"][platform_key]["numbered_headings"],
            )
            guide = role
            json_titles = [s["title_en"] for s in json_data[guide]["flat"]]
            json_flat = json_data[guide]["flat"]

            def find_content(sections, sid):
                for sec_node in sections:
                    if sec_node["id"] == sid:
                        return (sec_node.get("content", {}).get("en", "") or "")
                    if sec_node.get("children"):
                        r = find_content(sec_node["children"], sid)
                        if r:
                            return r
                return ""

            mitaxi_integration = []
            for h in mitaxi_only:
                score, match = fuzzy_match(h["title"], json_titles)
                nt = normalize_title(h["title"])
                keyword_hits = []
                words = [w for w in nt.split() if len(w) > 3]
                for sec in json_flat:
                    en_body = find_content(json_data[guide]["raw"]["sections"], sec["id"])
                    en_norm = normalize_title(en_body[:2000])
                    if words and sum(1 for w in words if w in en_norm) >= max(1, len(words) // 2):
                        keyword_hits.append(sec["title_en"])

                if score >= 0.55:
                    status = "integrated"
                elif keyword_hits:
                    status = "partial"
                else:
                    status = "missing"

                mitaxi_integration.append({
                    "number": h["number"],
                    "title": h["title"],
                    "status": status,
                    "json_title_match": match,
                    "match_score": round(score, 2),
                    "content_keyword_hits": keyword_hits[:3],
                })

            report["mitaxi_features"][role] = {
                "mitaxi_only_topics": [{"number": h["number"], "title": h["title"]} for h in mitaxi_only],
                "platform_only_topics": [{"number": h["number"], "title": h["title"]} for h in platform_only[:20]],
                "integration_status": mitaxi_integration,
            }

    # Per-guide: images, bilingual, empty sections
    for guide in JSON_MAP:
        flat = json_data[guide]["flat"]
        img_report = check_images(guide, flat)

        bilingual_gaps = []
        empty_content = []
        empty_parents = []
        placeholders = []
        for s in flat:
            if s["en_empty"] and s["es_empty"] and s["children_count"] == 0:
                empty_content.append(s)
            elif s["en_empty"] and s["es_empty"] and s["children_count"] > 0:
                empty_parents.append(s)
            if s["en_empty"] and not s["es_empty"]:
                bilingual_gaps.append({"section": s["path"], "missing": "en"})
            if s["es_empty"] and not s["en_empty"]:
                bilingual_gaps.append({"section": s["path"], "missing": "es"})
            if s["has_placeholder"]:
                placeholders.append(s)

        pdf_keys = [k for k, v in PDF_TO_JSON.items() if v == guide]
        match_pcts = [
            report["comparisons"][k]["match_pct"]
            for k in pdf_keys
            if k in report["comparisons"]
        ]
        best_pct = max(match_pcts) if match_pcts else 0

        status = assess_guide_status(
            flat, best_pct, len(empty_parents), len(bilingual_gaps), img_report["broken_refs"]
        )

        report["guides"][guide]["images"] = img_report
        report["guides"][guide]["bilingual_gaps"] = bilingual_gaps
        report["guides"][guide]["empty_leaf_sections"] = [
            {"id": s["id"], "number": s["number"], "title_en": s["title_en"]}
            for s in empty_content
        ]
        report["guides"][guide]["empty_parent_sections"] = [
            {"id": s["id"], "number": s["number"], "title_en": s["title_en"], "children": s["children_count"]}
            for s in empty_parents
        ]
        report["guides"][guide]["placeholders"] = [
            {"id": s["id"], "title_en": s["title_en"]} for s in placeholders
        ]
        report["guides"][guide]["status"] = status
        report["guides"][guide]["pdf_coverage_pct"] = best_pct

    # Admin truncation check
    if "admin" in report["pdfs"]:
        last = report["pdfs"]["admin"]["last_page_snippet"]
        report["admin_truncation"] = {
            "pdf_pages": report["pdfs"]["admin"]["pages"],
            "last_page_ends_with": last[-300:].strip(),
            "json_has_12_13_to_12_17": all(
                any(s["number"] == n for s in json_data["admin"]["flat"])
                for n in ["12.13", "12.14", "12.15", "12.16", "12.17"]
            ),
            "sections_12_13_17_have_content": {},
        }
        for n in ["12.13", "12.14", "12.15", "12.16", "12.17"]:
            sec = next((s for s in json_data["admin"]["flat"] if s["number"] == n), None)
            if sec:
                report["admin_truncation"]["sections_12_13_17_have_content"][n] = {
                    "title": sec["title_en"],
                    "en_len": sec["en_len"],
                    "es_len": sec["es_len"],
                    "en_empty": sec["en_empty"],
                }

    # Write report
    out_path = ROOT / "audit_report.json"
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)

    # Print summary
    print("=== EXECUTIVE SUMMARY ===")
    for guide in JSON_MAP:
        g = report["guides"][guide]
        print(f"{guide.upper()}: {g['status'].upper()} | sections={g['total_sections']} | pdf_coverage={g.get('pdf_coverage_pct',0):.0%} | broken_images={len(g['images']['broken_refs'])} | bilingual_gaps={len(g['bilingual_gaps'])} | empty_leaves={len(g['empty_leaf_sections'])}")

    print("\n=== PDF HEADINGS (top-level) ===")
    for key in PDF_MAP:
        if key in report["pdfs"] and "pages" in report["pdfs"][key]:
            h = report["pdfs"][key]["numbered_headings"]
            top = [x for x in h if "." not in x["number"] or x["number"].count(".") == 0]
            print(f"\n{key} ({report['pdfs'][key]['pages']} pages, {len(h)} numbered headings):")
            for x in top[:15]:
                print(f"  {x['number']} {x['title']}")

    print("\n=== MiTaxi CUSTOM FEATURES ===")
    for role in ["driver", "passenger"]:
        if role in report["mitaxi_features"]:
            mf = report["mitaxi_features"][role]
            print(f"\n{role.upper()} MiTaxi-only ({len(mf['mitaxi_only_topics'])}):")
            for t in mf["mitaxi_only_topics"]:
                integ = next((i for i in mf["integration_status"] if i["title"] == t["title"]), {})
                print(f"  [{integ.get('status','?')}] {t['number']} {t['title']}")

    print(f"\nFull report: {out_path}")


if __name__ == "__main__":
    main()