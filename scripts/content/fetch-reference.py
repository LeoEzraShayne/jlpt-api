#!/usr/bin/env python3
"""Fetch attributed JMdict + Waller/Tanos reference levels; never exam frequency.
Python standard library only. Outputs JSON accepted by import-reference.ts.
"""
import argparse
import csv
import datetime
import gzip
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

JMDICT = 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz'
MAPPING_REPO = 'https://github.com/stephenmk/yomitan-jlpt-vocab'
MAPPING_API = 'https://api.github.com/repos/stephenmk/yomitan-jlpt-vocab/commits/main'
LICENSE_URL = 'https://www.edrdg.org/edrdg/licence.html'


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'JLPT-content-import/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read(), response.headers.get('Last-Modified')


def generate(output, limit, cache):
    cache.mkdir(parents=True, exist_ok=True)
    revision = json.loads(download(MAPPING_API)[0])['sha']
    mappings = {}
    for level in ['N1', 'N2', 'N3', 'N4']:
        url = f'https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/{revision}/original_data/{level.lower()}.csv'
        data, _ = download(url)
        (cache / f'{level}.csv').write_bytes(data)
        for row in csv.DictReader(io.StringIO(data.decode('utf-8-sig'))):
            mappings.setdefault(row['jmdict_seq'], []).append({**row, 'level': level, 'url': url})
    raw, modified = download(JMDICT)
    xml = gzip.decompress(raw)
    (cache / 'JMdict_e.gz').write_bytes(raw)
    (cache / 'edrdg-license.html').write_bytes(download(LICENSE_URL)[0])
    mapping_license_url = f'https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/{revision}/LICENSE.txt'
    (cache / 'mapping-LICENSE.txt').write_bytes(download(mapping_license_url)[0])
    version = modified or datetime.datetime.now(datetime.timezone.utc).isoformat()
    checksum = hashlib.sha256(raw).hexdigest()
    counts = {level: 0 for level in ['N1', 'N2', 'N3', 'N4']}
    entries, seen = [], set()
    for _, element in ET.iterparse(io.BytesIO(xml), events=('end',)):
        if element.tag != 'entry':
            continue
        seq = element.findtext('ent_seq')
        candidates = mappings.get(seq, [])
        for mapping in candidates:
            level = mapping['level']
            if limit and counts[level] >= limit:
                continue
            reading = mapping['kana']
            reading_nodes = [r for r in element.findall('r_ele') if r.findtext('reb') == reading]
            if not reading_nodes:
                continue
            spellings = [k.findtext('keb') for k in element.findall('k_ele')]
            requested = mapping['kanji'] or reading
            if requested != reading and requested not in spellings:
                continue
            restrictions = [r.text for r in reading_nodes[0].findall('re_restr')]
            if restrictions and requested not in restrictions:
                continue
            word = requested
            inherited_pos = []
            matched = False
            for sense in element.findall('sense'):
                pos = [p.text for p in sense.findall('pos')] or inherited_pos
                inherited_pos = pos
                stagk = [s.text for s in sense.findall('stagk')]
                stagr = [s.text for s in sense.findall('stagr')]
                if (stagk and word not in stagk) or (stagr and reading not in stagr):
                    continue
                glosses = [{'language': g.attrib.get('{http://www.w3.org/XML/1998/namespace}lang', 'eng'),
                            'text': g.text, 'type': g.attrib.get('g_type')} for g in sense.findall('gloss')]
                if not glosses:
                    continue
                sense_key = hashlib.sha256(json.dumps([pos, glosses], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
                identity = (seq, word, reading, sense_key)
                if identity in seen:
                    continue
                seen.add(identity)
                entries.append({'word': word, 'reading': reading, 'senseKey': sense_key,
                    'partOfSpeech': pos, 'glosses': glosses, 'level': level,
                    'levelSource': 'Jonathan Waller/Tanos, mapped to JMdict by Stephen McInerney; reference only, not official',
                    'sourceName': 'JMdict/EDRDG', 'sourceUrl': JMDICT, 'sourceVersion': version,
                    'sourceEntryId': seq, 'license': 'CC-BY-SA-4.0',
                    'provenance': {'dictionarySha256': checksum, 'mappingRevision': revision,
                        'mappingUrl': mapping['url'], 'mappingLicense': 'CC-BY-SA-4.0',
                        'originalLevelSource': 'https://www.tanos.co.uk/jlpt/',
                        'originalLevelLicense': 'CC-BY', 'dictionaryLicenseUrl': LICENSE_URL,
                        'levelIsOfficial': False, 'frequencyRank': None}})
                matched = True
            if matched:
                counts[level] += 1
        element.clear()
    if not entries or any(count == 0 for count in counts.values()):
        raise ValueError(f'No usable reference entries for one or more levels: {counts}')
    document = {'format': 'jlpt-reference-v1', 'license': 'CC-BY-SA-4.0',
        'attribution': 'JMdict © Electronic Dictionary Research and Development Group; JLPT reference mapping © Jonathan Waller and Stephen McInerney.',
        'dictionarySha256': checksum, 'mappingRevision': revision, 'entryCountsByLevel': counts,
        'entries': entries}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'wordsByLevel': counts, 'senses': len(entries)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--per-level', type=int, default=100, help='0 = all mapped entries; otherwise words per level')
    args = parser.parse_args()
    if args.per_level < 0:
        parser.error('--per-level must be non-negative')
    generate(args.output, args.per_level, args.cache)
