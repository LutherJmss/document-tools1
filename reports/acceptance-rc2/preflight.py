from pathlib import Path
import subprocess,json,hashlib,zipfile,shutil,platform
r=Path.cwd();repo=r/'document-tools-v143';q=r/'qa/v143';out=r/'qa/v143-rc2'
def git(*args):return subprocess.check_output(['git',*args],cwd=repo)
commands=[['status','--porcelain=v1','--branch'],['log','-6','--format=%H %aI %s'],['branch','-vv'],['remote'],['rev-parse','--is-shallow-repository'],['diff','--check'],['diff','--check','ae2b77a','HEAD'],['fsck','--connectivity-only']]
logs=[];checks=[]
for args in commands:
 p=subprocess.run(['git',*args],cwd=repo,text=True,capture_output=True);logs.append('$ git '+' '.join(args)+'\nexit='+str(p.returncode)+'\n'+p.stdout+p.stderr);checks.append({'command':['git',*args],'exitCode':p.returncode})
(out/'git-preflight.log').write_text('\n'.join(logs))
sha=git('rev-parse','HEAD').decode().strip();artifact=[]
for n,m in json.loads((r/'deliverables/v143/SHA256.json').read_text()).items():
 f=r/'deliverables/v143'/n;artifact.append({'file':n,'sizeMatch':f.stat().st_size==m['bytes'],'sha256Match':hashlib.sha256(f.read_bytes()).hexdigest()==m['sha256']})
results={};logsfull=(r/'deliverables/v143/V1.4.3-测试日志.txt').read_text()
for n in ['regression','structure-tests','image-tests','formula-tests','text-tests','table-tests','fallback-tests','portable-structure','rc2-questions','artifact-audit','mobile-tests','benchmark','visual-audit','text_quality_report']:
 f=q/(n+'.json');data=json.loads(f.read_text());results[n]={'file':str(f.relative_to(r)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'parsed':True,'inConsolidatedLog':('===== '+n+'.json =====') in logsfull}
 if n=='regression':results[n]['summary']={'passed':len(data['results']),'errors':data['errors'],'downloads':data['downloads']}
 elif 'passed' in data:results[n]['summary']={k:v for k,v in data.items() if k in ['passed','cases','restored','fallback','selectionChecks']}
record=json.loads((q/'existing-tests-source.json').read_text());regressionSourceUnchanged=hashlib.sha256((r/'qa/rc2/regression.cjs').read_bytes()).hexdigest()==record['sha256']
unchanged={n:git('show','ae2b77a:'+n)==(repo/n).read_bytes() for n in ['tests/rc1-structure.test.mjs','tests/rc2-question.test.mjs']}
with zipfile.ZipFile(r/'deliverables/v143/V1.4.3-RC1源代码.zip') as z:
 sourceMatches=all(z.read('document-tools-v143/'+n)==git('show','HEAD:'+n) for n in git('ls-files','-z').decode().split('\0') if n)
with zipfile.ZipFile(r/'deliverables/v143/V1.4.3-验证资料.zip') as z:
 zipOK=z.testzip() is None;missing=[x['file'] for x in results.values() if x['file'] not in z.namelist()]
report={'reviewedCommit':sha,'statusCleanBeforeAcceptanceDocs':not git('status','--porcelain').strip(),'gitChecks':checks,'remoteConfigured':bool(git('remote').strip()),'upstreamConfigured':False,'localMainAvailable':False,'shallowRepository':True,'gitHubRemoteCI':'not_verified_no_remote','artifacts':artifact,'sourceArchiveMatchesReviewedCommit':sourceMatches,'verificationZipCRCValid':zipOK,'verificationZipMissingRequiredResults':missing,'existingRegressionSourceUnchanged':regressionSourceUnchanged,'existingTrackedTestsUnchanged':unchanged,'testLogs':results,'testRunThisRound':False,'reasonNoRerun':'application code unchanged; audit prior test evidence and hashes','nativeMobile':{'environment':platform.system()+' '+platform.machine(),'availableDeviceTools':{n:shutil.which(n) for n in ['adb','emulator','xcrun','idevice_id','appium']},'deviceConnectorAvailable':False,'matrix':[{'app':a,'os':os,'status':'blocked_not_executed','reason':'no native device or app session'} for a in ['WPS','Word'] for os in ['Android','iOS']]}}
(out/'preflight.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
assert all(x['sha256Match'] and x['sizeMatch'] for x in artifact)
assert sourceMatches and zipOK and not missing and regressionSourceUnchanged and all(unchanged.values())
assert all(x['inConsolidatedLog'] for x in results.values())
print(json.dumps({'reviewedCommit':sha,'artifactsVerified':len(artifact),'requiredTestResults':len(results),'allPresentInConsolidatedLog':True,'sourceArchiveMatches':sourceMatches,'zipCRC':zipOK,'applicationChanged':False,'gitChecks':checks,'mobileActualRuns':0},ensure_ascii=False,indent=2))
