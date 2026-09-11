import os, json, subprocess
from pathlib import Path
r=Path('/Users/superjj/ccproj/pm-replant')
e=r/'.agents/migrations/0.1.5/evidence/P3'
env=os.environ.copy(); env['PYTHONPATH']=str(r/'python/sdk/src')+':'+str(r/'python/sdk-runtime/src')
checks=[]
for scenario in ['sdk-snapshot','sdk-restart','sdk-minimal','sdk-minimal-in-history']:
 cmd=['/opt/miniconda3/bin/python',str(r/'scripts/smoke-python-runtime.py'),'--scenario',scenario,'--exe',str(r/'dist-exe/deepseek-harness-sdk-runtime-macos-arm64'),'--update-snapshots']
 with (e/(scenario+'-refresh.log')).open('w') as log:
  result=subprocess.run(cmd,cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT)
 checks.append({'command':cmd,'exitCode':result.returncode})
 (e/'python-refresh-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
 print(scenario,result.returncode,flush=True)
 if result.returncode: raise SystemExit(result.returncode)
