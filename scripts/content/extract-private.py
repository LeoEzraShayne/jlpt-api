#!/usr/bin/env python3
"""Read-only local material extraction to private preview JSON, never validated.
Run with bundled Python (openpyxl); XLS conversion uses LibreOffice in temp dir.
DOC/DOCX: macOS textutil. PDF: pdftotext. Scanned PDFs are reported/skipped.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def plain(value):
    return str(value).strip() if value is not None else ''


def row(word, reading, gloss, location, kind='VOCABULARY', level=None):
    item = dict(kind=kind, word=word, reading=reading, gloss=gloss, location=location)
    if level:
        item.update(level=level, levelSource=f'用户提供资料:{location}；未核实的参考分级')
    return item


def workbook_rows(path, soffice):
    import openpyxl
    with tempfile.TemporaryDirectory(prefix='jlpt-private-xls-') as directory:
        workbook_path = path
        if path.suffix.lower() == '.xls':
            subprocess.run([soffice, f'-env:UserInstallation={Path(directory).as_uri()}/profile',
                '--headless', '--convert-to', 'xlsx', '--outdir', directory, str(path)],
                check=True, capture_output=True)
            workbook_path = Path(directory) / (path.stem + '.xlsx')
        workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
        result = []
        for sheet in workbook:
            if sheet.title == '語彙（一級）':
                for number, cells in enumerate(sheet.values, 1):
                    if len(cells) >= 3 and cells[0] and cells[2]:
                        result.append(row(plain(cells[1] or cells[0]), plain(cells[0]),
                            plain(cells[2]), f'{path.name}#{sheet.title}!row{number}', level='N1'))
            elif re.match(r'^[一二]级(名词|动词|形容词|副词)$', sheet.title):
                for number, cells in enumerate(sheet.values, 1):
                    # Category sheets have two 4-column groups, sometimes with spacer.
                    offsets = [0, 5 if len(cells) >= 9 else 4]
                    for offset in offsets:
                        if len(cells) < offset + 4 or not cells[offset + 2] or not cells[offset + 3]:
                            continue
                        result.append(row(plain(cells[offset + 1] or cells[offset + 2]),
                            plain(cells[offset + 2]), plain(cells[offset + 3]),
                            f'{path.name}#{sheet.title}!row{number}:col{offset + 1}',
                            level='N1' if sheet.title.startswith('一') else 'N2'))
        workbook.close()
        return result


def text_rows(path):
    if path.suffix.lower() == '.pdf':
        text = subprocess.run(['pdftotext', '-layout', str(path), '-'],
            check=True, capture_output=True).stdout.decode('utf-8')
    elif path.suffix.lower() in ['.doc', '.docx']:
        text = subprocess.run(['textutil', '-convert', 'txt', '-stdout', str(path)],
            check=True, capture_output=True).stdout.decode('utf-8')
    else:
        raw = path.read_bytes()
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = raw.decode('gb18030')
    result = []
    if len(text.strip()) < 50:
        return result
    for number, line in enumerate(text.splitlines(), 1):
        # Preserve only confidently delimited word-table or phrase pairs.
        cols = re.split(r'\s{2,}|\t+', line.strip())
        if len(cols) >= 5 and cols[0].isdigit() and re.fullmatch(r'[ぁ-ゖァ-ヺー・ ]+', cols[2]):
            result.append(row(cols[1], cols[2], cols[4], f'{path.name}:line{number}'))
            continue
        phrase = re.match(r'^\s*[※＊*]\s*(.+?)\s+[/／]\s+(.+?)\s*$', line)
        if phrase and re.search(r'[ぁ-ゖァ-ヺ]', phrase[1]):
            result.append(row(phrase[1], '', phrase[2], f'{path.name}:line{number}', kind='PHRASE'))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--soffice', default=shutil.which('soffice') or '/Users/shen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = []
    for source in args.sources:
        rows = workbook_rows(source, args.soffice) if source.suffix.lower() in ['.xls', '.xlsx'] else text_rows(source)
        checksum = hashlib.sha256(source.read_bytes()).hexdigest()
        files = []
        for offset in range(0, len(rows), 500):
            payload = dict(fileName=source.name, sourceName=source.name,
                sourceVersion=checksum, rows=rows[offset:offset + 500])
            destination = args.output / f'{checksum[:12]}-{offset // 500 + 1}.preview.json'
            destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
            files.append(destination.name)
        report.append(dict(source=str(source), sourceSha256=checksum, candidates=len(rows),
            status='PENDING' if rows else 'NO_CONFIDENT_TEXT_ROWS_REVIEW_MANUALLY',
            visibility='PRIVATE', previewFiles=files))
    (args.output / 'extraction-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
