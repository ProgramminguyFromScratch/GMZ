"""
rename_thumbs.py

Problem:
    Images are currently named by row POSITION:
        assets/smallthumbs/cellImage_{gid}_{rowIndex}.jpg
    Inserting or reordering a row in the sheet shifts every image after it,
    so images stop matching their levels.

Fix:
    Rename each image to use the level's stable ID instead:
        assets/thumbs/{id}.jpg
    IDs don't shift when you insert a row elsewhere, so this survives
    future edits to the sheet.

Inputs you have:
    1. An HTML export of the sheet tab (File > Download > Web page (.html)),
       used only to read column A (the ID) in row order.
    2. A separate folder of images already named cellImage_{gid}_{row}.*

This script reads the HTML table to build a rowIndex -> id mapping, then
for each row looks up assets/smallthumbs/cellImage_{gid}_{rowIndex}.* in
your images folder and copies/renames it to assets/thumbs/{id}.jpg.

Usage:
    python3 rename_thumbs.py \
        --html gm_sheet.html \
        --images-dir ./assets/smallthumbs \
        --out ./assets/thumbs \
        --gid 0 \
        --id-col 0 \
        --header-rows 1

    Run once per sheet/tab (GM, Master, Expert, unverified), matching
    --gid to the gid used in the existing filenames in --images-dir.

Notes:
    - This performs a COPY (not an in-place rename) by default, so your
      original cellImage_* files are left untouched. Pass --move to
      rename in place instead.
    - The HTML's row order MUST match the row order the images were
      originally captured in - i.e. run this against a sheet snapshot
      taken before you insert any new rows.
    - If a row's ID cell is empty, or the corresponding image file
      doesn't exist in --images-dir, that row is skipped with a warning.
    - If two rows share the same ID, the later one wins and a warning is
      printed - level IDs must be unique.
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

from bs4 import BeautifulSoup


def sanitize_id(raw_id: str) -> str:
    """
    Keep the ID close to literal (only strip characters illegal in
    filenames), since the site looks images up with
    `assets/thumbs/${encodeURIComponent(id)}.jpg`, and encodeURIComponent
    just escapes for the URL - it doesn't turn spaces/punctuation into
    underscores. Browsers/static file servers decode the URL back to the
    literal filename automatically.
    """
    raw_id = raw_id.strip()
    return re.sub(r'[\/\\:\*\?"<>\|]', "_", raw_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--html", required=True, help="Path to the exported sheet .html file")
    parser.add_argument("--images-dir", required=True, help="Folder containing the existing cellImage_{gid}_{row}.* files")
    parser.add_argument("--out", required=True, help="Output directory, e.g. ./assets/thumbs")
    parser.add_argument("--gid", required=True, help="The gid used in the existing filenames, e.g. cellImage_<gid>_0.jpg")
    parser.add_argument("--id-col", type=int, default=0, help="0-indexed column containing the level ID (default 0 = column A)")
    parser.add_argument("--header-rows", type=int, default=2, help="Number of header rows to skip (default 2: Google's export has both a column-letter row (A,B,C...) and a field-name row (ID/Rank/Name...) before the data starts)")
    parser.add_argument("--ext", default=None, help="Force a specific source extension (jpg/png/etc). Default: auto-detect per file.")
    parser.add_argument("--move", action="store_true", help="Move/rename instead of copying")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without touching files")
    parser.add_argument("--debug", action="store_true", help="Print the row-index -> id mapping the parser sees, then exit without copying anything")
    args = parser.parse_args()

    html_path = Path(args.html).expanduser()
    images_dir = Path(args.images_dir).expanduser()
    out_dir = Path(args.out).expanduser()

    if not html_path.exists():
        sys.exit(f"HTML file not found: {html_path}")
    if not images_dir.exists():
        sys.exit(f"Images directory not found: {images_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)

    soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="ignore"), "html.parser")
    table = soup.find("table")
    if table is None:
        sys.exit("No <table> found in the HTML file.")

    rows = table.find_all("tr")
    data_rows = rows[args.header_rows:]

    def expand_cells(tr):
        """
        Flatten a row's *data* cells into a list where each entry occupies
        its real column position, accounting for colspan.

        Only <td> elements are used - Google's export often adds a leading
        <th> per row (the row-number gutter, e.g. "1", "2", "3"...) which is
        NOT part of the actual data and would otherwise shift every column
        index over by one.
        """
        expanded = []
        for cell in tr.find_all("td", recursive=False):
            span = int(cell.get("colspan", 1) or 1)
            expanded.append(cell)
            for _ in range(span - 1):
                expanded.append(cell)  # placeholder, keeps column position
        return expanded

    def is_spacer_row(tr):
        """
        Google's export sometimes inserts empty 'freezebar' spacer rows
        (frozen-row/column dividers) that aren't real data and would
        otherwise be miscounted as a row with no ID.
        """
        cells = tr.find_all(["td", "th"], recursive=False)
        if not cells:
            return True
        classes = " ".join(" ".join(c.get("class", [])) for c in cells if hasattr(c, "get"))
        text = "".join(c.get_text(strip=True) for c in cells)
        return "freezebar" in classes and not text

    data_rows = [tr for tr in data_rows if not is_spacer_row(tr)]

    if args.debug:
        print(f"--- DEBUG: showing first 15 rows as parsed (id-col={args.id_col}, header-rows={args.header_rows}) ---")
        for row_index, tr in enumerate(data_rows[:15]):
            cells = expand_cells(tr)
            cell_texts = [c.get_text(strip=True) for c in cells]
            id_val = cell_texts[args.id_col] if len(cell_texts) > args.id_col else "<MISSING>"
            print(f"row {row_index}: id_col_value={id_val!r}  all_cells={cell_texts[:8]}")
        print("--- end debug ---")
        print("If id_col_value looks wrong (e.g. row numbers, blank, or the wrong field),")
        print("adjust --id-col and re-run with --debug until it lines up, then drop --debug.")
        return

    def find_source_image(row_index: int):
        base = f"cellImage_{args.gid}_{row_index}"
        if args.ext:
            candidate = images_dir / f"{base}.{args.ext.lstrip('.')}"
            return candidate if candidate.exists() else None
        matches = list(images_dir.glob(f"{base}.*"))
        return matches[0] if matches else None

    seen_ids = {}
    copied = 0
    skipped_no_id = 0
    skipped_no_image = 0

    for row_index, tr in enumerate(data_rows):
        cells = expand_cells(tr)
        if len(cells) <= args.id_col:
            continue

        raw_id = cells[args.id_col].get_text(strip=True)
        if not raw_id:
            skipped_no_id += 1
            continue

        src_path = find_source_image(row_index)
        if src_path is None:
            skipped_no_image += 1
            print(f"[warn] row {row_index}: id='{raw_id}' has no matching image "
                  f"(looked for cellImage_{args.gid}_{row_index}.*), skipping", file=sys.stderr)
            continue

        safe_id = sanitize_id(raw_id)
        if safe_id in seen_ids:
            print(f"[warn] duplicate id '{safe_id}' (rows {seen_ids[safe_id]} and {row_index}) - "
                  f"overwriting with the later row", file=sys.stderr)
        seen_ids[safe_id] = row_index

        dest_path = out_dir / f"{safe_id}{src_path.suffix}"
        if args.dry_run:
            action = "move" if args.move else "copy"
            print(f"[dry-run] {action}: {src_path.name} -> {dest_path.name}")
        else:
            if args.move:
                shutil.move(str(src_path), str(dest_path))
            else:
                shutil.copyfile(src_path, dest_path)
        copied += 1

    print(f"\nDone. {copied} images written to {out_dir}")
    print(f"Skipped: {skipped_no_id} rows with no ID, {skipped_no_image} rows with no matching source image.")


if __name__ == "__main__":
    main()