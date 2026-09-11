import json, hashlib
from pathlib import Path
import zstandard
p=Path('/Users/superjj/ccproj/DSHscience/.agents/tmp/agent-work/2026-09-09-upstream-0.1.5-migration/execution/P0/samples.json')
out=[]
for item in json.loads(p.read_text()):
 path=Path(item['path']); data=path.read_bytes()
 with zstandard.ZstdDecompressor().stream_reader(data,read_across_frames=True) as reader:
  rows=[json.loads(line) for line in reader.read().splitlines() if line.strip()]
 out.append({'category':item['category'],'path':str(path),'sha256':hashlib.sha256(data).hexdigest(),'header':rows[0],'types':sorted(set(row['type'] for row in rows[1:] if row['type'].startswith('science/')))})
Path('/private/tmp/pm-p3-legacy-metadata.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps([{'category':i['category'],'version':i['header']['version'],'types':i['types']} for i in out],indent=2))
