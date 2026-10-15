#!/usr/bin/env python3
"""Compile declarative JSON into bounded plain TSV. Build-time only; no target Python.
--core-catalog imports device references from the shared core, not executable policy.
--check compares generated outputs without overwriting them.
"""
import argparse,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def build(data):
    if data.get('schema')!='macdiag.diagnostics.registry.v1': raise ValueError('registry schema')
    out={}
    for key,n in [('devices',5),('profiles',8),('tools',5),('tests',3)]:
        rows=data[key]
        if not isinstance(rows,list) or not 1<=len(rows)<=4096: raise ValueError(key)
        lines=[];seen=set()
        for row in rows:
            if len(row)!=n or any(not isinstance(x,str) or not x or len(x)>256 or re.search(r'[\x00-\x1f\x7f]',x) for x in row): raise ValueError('invalid row '+key)
            ident=tuple(row[:2]) if key=='devices' else row[0]
            if ident in seen: raise ValueError('duplicate '+str(ident))
            seen.add(ident);lines.append('\t'.join(row)+'\n')
        out['registry_'+key+'.tsv']=''.join(lines)
    return out

def main():
    a=argparse.ArgumentParser();a.add_argument('--check',action='store_true');a.add_argument('--core-catalog',type=Path);args=a.parse_args()
    src=ROOT/'registry/diagnostics.json';data=json.loads(src.read_text())
    if args.core_catalog:
        raw=args.core_catalog.read_bytes();core=json.loads(raw)
        data['devices']=[[d['model_identifier'],str(d['year_introduced']),d['name'],d['source'],d.get('hardware_test','NOT_TESTED')] for d in core['devices']]
        data['device_import']['blob_sha']=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        data['device_import']['commit']='UPDATE_TO_VERIFIED_COMMIT'
        if args.check: raise ValueError('--core-catalog cannot be combined with --check')
        src.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    for name,text in build(data).items():
        p=ROOT/'diagnostics_v2'/name
        if args.check:
            if p.read_text()!=text: raise ValueError('stale generated table '+name)
        else:p.write_text(text,encoding='utf-8')
    print('REGISTRY_TABLES_OK')
if __name__=='__main__':main()
