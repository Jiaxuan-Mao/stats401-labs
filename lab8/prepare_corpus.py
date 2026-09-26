"""Tasks 1–4: extract meaningful prose using the bulletin's own PDF outline.
Usage: python lab8/prepare_corpus.py --pdf /path/to/bulletin.pdf --output data
Original PDF is read-only. Tables, front matter and reference calendars/contacts
are excluded explicitly; raw paragraph candidates and rejection reasons are saved.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata

import pandas as pd
import pdfplumber
from pypdf import PdfReader

SOURCE = 'https://dku-web-admissions.s3.cn-north-1.amazonaws.com.cn/dkumain/files/V2021-22_DKU_UG_Bulletin.pdf'

def clean(s):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', s).replace('\u00ad', '')).strip()

def key(s):
    return re.sub(r'[^a-z0-9]', '', clean(s).lower())

def read_outline(reader):
    records = []
    def visit(items, level=1):
        for item in items:
            if isinstance(item, list):
                visit(item, level + 1)
            else:
                page = reader.get_destination_page_number(item) + 1
                records.append(dict(level=level, title=clean(item['/Title']), page=page,
                    top=float(reader.pages[page-1].mediabox.height)-float(item.get('/Top', 792))))
    visit(reader.outline)
    return records

def extract(pdf_path):
    outline = read_outline(PdfReader(pdf_path))
    rows, path, heading_audit = [], {}, []
    paragraph, start_page, end_page, paragraph_path = [], None, None, None
    stats = Counter()
    def flush():
        nonlocal paragraph, start_page, end_page, paragraph_path
        if paragraph:
            levels = paragraph_path.copy()
            chapter = levels.get(1, 'Unspecified')
            section = levels.get(2, 'Introduction')
            # Real subject headings provide useful sections within the long course catalogue.
            if section == 'Course Descriptions' and 3 in levels:
                section = levels[3]
                subsection = ' > '.join(levels[k] for k in sorted(levels) if k >= 4) or 'Overview'
            else:
                subsection = ' > '.join(levels[k] for k in sorted(levels) if k >= 3) or 'Overview'
            rows.append(dict(chapter=chapter, section=section, subsection=subsection,
                page=start_page, page_end=end_page, text=clean(' '.join(paragraph)),
                hierarchy_path=' > '.join(levels[k] for k in sorted(levels))))
        paragraph, start_page, end_page, paragraph_path = [], None, None, None
    with pdfplumber.open(pdf_path) as pdf:
        for pno in range(10, 397):
            page = pdf.pages[pno-1]
            lines = page.extract_text_lines(layout=False)
            lines = [line for line in lines if 60 < line['top'] < 735 and clean(line['text'])]
            headings = [r.copy() for r in outline if r['page'] == pno]
            heading_line_ids = set()
            events = {}
            for h in headings:
                # Two bookmark typos verified against visible PDF headings.
                if h['page'] == 91 and h['title'].endswith('10F'):
                    h['title'] = h['title'][:-3] + '11'
                if h['page'] == 395 and h['title'].startswith('WOC 202'):
                    h['title'] = h['title'].replace('(4 credits)', '(2 credits)')
                target = key(h['title'])
                candidates = []
                for i,line in enumerate(lines):
                    if abs(line['top'] - h['top']) > 65:
                        continue
                    for length in range(1, 5):
                        combined = key(' '.join(l['text'] for l in lines[i:i+length]))
                        if combined == target or (len(combined)>15 and (combined.startswith(target) or target.startswith(combined)) and len(combined)/len(target)>.94):
                            candidates.append((abs(line['top']-h['top']) + abs(len(combined)-len(target)), i, length))
                if candidates:
                    _, idx, length = min(candidates)
                    h['actual_top'] = lines[idx]['top']
                    heading_line_ids.update(range(idx,idx+length))
                    h['matched'] = True
                else:
                    h['actual_top'] = h['top'] + 4
                    h['matched'] = False
                heading_audit.append(h)
            headings.sort(key=lambda h:(h['actual_top'],h['level']))
            # Ruled degree-requirement tables are lists, not prose paragraphs.
            tables = page.find_tables()
            table_boxes = [t.bbox for t in tables if len(t.rows)>1]
            stats['tables_excluded'] += len(table_boxes)
            previous = None
            for i,line in enumerate(lines):
                while headings and headings[0]['actual_top'] <= line['top']+1:
                    h = headings.pop(0)
                    flush()
                    path = {level:title for level,title in path.items() if level<h['level']}
                    path[h['level']] = h['title']
                if i in heading_line_ids:
                    flush();previous=None;continue
                if any(box[1]-1 <= (line['top']+line['bottom'])/2 <= box[3]+1 for box in table_boxes):
                    flush();previous=None;stats['table_lines_excluded']+=1;continue
                text=clean(line['text'])
                if re.fullmatch(r'\d+',text):
                    stats['page_numbers_excluded']+=1;continue
                # Smaller bottom-of-page type is a footnote, not a continuation.
                maxsize=max(c['size'] for c in line['chars'])
                if maxsize<10 and line['top']>550:
                    flush();previous=None;stats['footnote_lines_excluded']+=1;continue
                gap = line['top']-previous['bottom'] if previous else 0
                if previous and gap>6:
                    flush()
                if paragraph and paragraph_path != path:
                    flush()
                if not paragraph:
                    start_page=pno;paragraph_path=path.copy()
                # Join a word broken at a line ending; preserve ordinary internal hyphens.
                if paragraph and paragraph[-1].endswith('-') and text[:1].islower():
                    paragraph[-1]=paragraph[-1][:-1]+text
                else:
                    paragraph.append(text)
                end_page=pno;previous=line
            # Keep a visibly unfinished sentence for continuation onto the next page.
            if paragraph and re.search(r'[.!?:;\)\]”"]$',paragraph[-1]):
                flush()
            page.close()
            if pno%40==0:print('Extracted through PDF page',pno,flush=True)
    flush()
    return pd.DataFrame(rows),heading_audit,dict(stats)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--pdf',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'data')
    parser.add_argument('--accessed',default='2026-09-23')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    raw,headings,exclusions=extract(args.pdf)
    print('RAW INSPECTION',raw.shape,raw.dtypes.to_dict(),raw.isna().sum().to_dict(), 'duplicates',raw.duplicated('text').sum(),flush=True)
    raw.insert(0,'raw_id',[f'r{i+1:05d}' for i in range(len(raw))])
    raw['text_clean']=raw.text.map(clean)
    raw['word_count']=raw.text_clean.str.split().str.len()
    raw['rejection_reason']=''
    raw.loc[raw.word_count<20,'rejection_reason']='short_fragment_under_20_words'
    raw.loc[raw.text_clean.str.match(r'^Prerequisite\(s\):',case=False),'rejection_reason']='standalone_prerequisite_list'
    duplicate=raw.loc[raw.rejection_reason.eq('')].duplicated('text_clean')
    raw.loc[duplicate[duplicate].index,'rejection_reason']='duplicate_normalized_text'
    raw.to_csv(args.output/'lab8_raw_passages.csv',index=False)
    df=raw.loc[raw.rejection_reason.eq('')].drop(columns='rejection_reason').copy().reset_index(drop=True)
    df.insert(0,'passage_id',[f'p{i+1:05d}' for i in range(len(df))])
    assert df[['chapter','section','subsection','page','text']].notna().all().all()
    assert not df.text_clean.duplicated().any()
    assert df.word_count.ge(20).all()
    df.to_csv(args.output/'bulletin_passages.csv',index=False)
    sections=df.groupby(['chapter','section'],sort=False).agg(count=('text','size'),mean_words=('word_count','mean')).reset_index()
    sections.to_csv(args.output/'lab8_section_summary.csv',index=False)
    report=dict(title='Bulletin of Duke Kunshan University Undergraduate Instruction',academic_year='2021–2022',
        version='July 2021; supplied PDF V2021-22',source=SOURCE,accessed=args.accessed,pdf_pages=400,
        source_sha256=sha256(args.pdf.read_bytes()).hexdigest(),raw_passages=len(raw),clean_passages=len(df),
        average_words=float(df.word_count.mean()),median_words=float(df.word_count.median()),max_words=int(df.word_count.max()),
        formal_sections=len(sections),chapters=int(df.chapter.nunique()),pages_with_retained_text=int(df.page.nunique()),
        cleaning_reasons=raw.rejection_reason.value_counts().to_dict(),exclusions=exclusions,
        scope='Narrative paragraphs and course descriptions on PDF pages 10–396 (Parts 1–10). Excludes cover/editorial/contents pages 1–9, calendars/contact lists 397–400, ruled course tables, small footnotes, standalone prerequisite lists and fragments under 20 words. Cross-page unfinished prose is joined; normalized exact duplicates retain their first occurrence.',
        hierarchy='chapter = original Part; section = original level-2 heading, except Course Descriptions uses its original subject heading at level 3; subsection = remaining deeper headings. Introduction/Overview explicitly mark absent lower headings; hierarchy_path preserves the full original outline.',
        heading_matches=sum(h['matched'] for h in headings),heading_total=len(headings))
    (args.output/'lab8_corpus_report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    (args.output/'lab8_outline_audit.json').write_text(json.dumps(headings,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=='__main__':main()
