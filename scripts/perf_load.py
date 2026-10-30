"""Bounded HTTP load against the isolated synthetic PostgreSQL workspace."""
from pathlib import Path
import argparse,asyncio,collections,json,math,os,random,statistics,time
import httpx
import psycopg

parser=argparse.ArgumentParser();parser.add_argument('--runtime',type=Path,required=True);parser.add_argument('--base-url',default='http://127.0.0.1:18746');parser.add_argument('--name',required=True);parser.add_argument('--duration',type=int,default=30);parser.add_argument('--concurrency',type=int,default=10);parser.add_argument('--health',action='store_true');parser.add_argument('--rps',type=float,default=0)
a=parser.parse_args()
from urllib.parse import urlsplit
runtime=json.loads(a.runtime.read_text());target=Path(runtime['target']);base=a.base_url.rstrip('/')
assert urlsplit(base).hostname in {'127.0.0.1','localhost','::1'}, 'Only isolated loopback services are allowed'
database=urlsplit(runtime['databases']['performance'].replace('postgresql+psycopg:','postgresql:'))
assert database.hostname in {'127.0.0.1','localhost','::1'} and database.path.lstrip('/').startswith('workbench_element_test'), 'Only isolated workbench_element_test* databases are allowed'
assert runtime['username'].startswith('perf-')
target.mkdir(parents=True,exist_ok=True)
assert a.duration > 0 and 1 <= a.concurrency <= 1000 and a.rps >= 0
pid=int(runtime.get('api_pid') or (target/'api.pid').read_text());HERTZ=os.sysconf('SC_CLK_TCK');PAGE=os.sysconf('SC_PAGE_SIZE')
def proc():
    todo=[pid];seen=set();cpu=0;rss=0
    while todo:
        n=todo.pop()
        if n in seen:continue
        seen.add(n)
        try:
            fields=Path(f'/proc/{n}/stat').read_text().split();cpu+=(int(fields[13])+int(fields[14]))/HERTZ
            rss+=int(Path(f'/proc/{n}/statm').read_text().split()[1])*PAGE
            todo+=list(map(int,Path(f'/proc/{n}/task/{n}/children').read_text().split()))
        except (FileNotFoundError,ProcessLookupError):pass
    return cpu,rss/1024/1024
def percentile(values,p):
    if not values:return None
    values=sorted(values);return round(values[min(len(values)-1,math.ceil(len(values)*p)-1)],2)

async def main():
    metrics=collections.defaultdict(lambda:{'latencies':[],'statuses':collections.Counter(),'bytes':0});samples=[];failures=[];running=True
    async with httpx.AsyncClient(base_url=base,timeout=15,limits=httpx.Limits(max_connections=max(20,a.concurrency+2),max_keepalive_connections=a.concurrency+2)) as client:
        response=await client.post('/api/v1/auth/login',json={'username':runtime['username'],'password':runtime['password']});response.raise_for_status()
        assert response.json()['user']['username'].startswith('perf-')
        client.headers['X-CSRF-Token']=client.cookies.get('wb_csrf') or ''
        tables=(await client.get('/api/v1/tables')).json();lists=(await client.get('/api/v1/todo-lists')).json();boards=(await client.get('/api/v1/dashboards')).json()
        table=next(t for t in tables if '全店' in t['name']);lst=lists[0];board=boards[0]
        writers=[]
        if not a.health:
            for i in range(a.concurrency):
                r=await client.post('/api/v1/memos',json={'title':f'PERF-only-{a.name}-{i}','content':'Synthetic benchmark write target','category':'PERF-ephemeral','color':'default'});r.raise_for_status();writers.append(r.json()['id'])
        reads=[('/tables','tables'),(f'/tables/{table["id"]}/records?page=1&page_size=50','records'),(f'/todos?list_id={lst["id"]}','todos'),('/memos','memos'),('/note-folders','note-folders'),('/note-tags','note-tags'),('/notes','notes'),('/dashboards','dashboards'),('/work-targets?kind=shop','targets')]
        # Ensure current-period rows exist before timing any request. This does not affect live data.
        r=await client.get('/api/v1/checkin-instances?kind=shop&period=daily');r.raise_for_status()
        reads.append(('/checkin-instances?kind=shop&period=daily','checkins'))
        async def monitor():
            lastcpu,lasttime=proc()[0],time.perf_counter()
            conn=await psycopg.AsyncConnection.connect(runtime['databases']['performance'].replace('postgresql+psycopg:','postgresql:'),autocommit=True)
            try:
                while running:
                    now=time.perf_counter();cpu,rss=proc()
                    cur=await conn.execute("SELECT state,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state")
                    states=dict(await cur.fetchall())
                    cur=await conn.execute('SELECT deadlocks,temp_bytes FROM pg_stat_database WHERE datname=current_database()');db=await cur.fetchone()
                    samples.append({'at_s':round(now-start,1),'api_cpu_percent':round((cpu-lastcpu)/max(.001,now-lasttime)*100,1),'api_rss_mb':round(rss,1),'connections':states,'deadlocks':db[0],'temp_bytes':db[1]})
                    lastcpu,lasttime=cpu,now
                    await asyncio.sleep(1)
            finally:await conn.close()
        start=time.perf_counter();end=start+a.duration
        async def worker(index):
            rng=random.Random(index+20261031);sequence=0
            while time.perf_counter()<end:
                sequence+=1;dice=rng.random()
                if a.health:method,path,name,body='GET','/health','health',None
                elif dice<.8:path,name=rng.choice(reads);method,body='GET',None
                elif dice<.95:method,path,name,body='PATCH',f'/memos/{writers[index]}','memo-write',{'content':f'Synthetic load only: worker {index}, sequence {sequence}'}
                else:method,path,name,body='GET',f'/dashboards/{board["id"]}/data','dashboard-data',None
                begun=time.perf_counter()
                try:
                    response=await client.request(method,'/api/v1'+path,json=body)
                    status=str(response.status_code);length=len(response.content)
                    if response.status_code>=400 and len(failures)<10:
                        try:detail=response.json().get('code','')
                        except Exception:detail='non-json'
                        failures.append({'endpoint':name,'status':status,'code':detail})
                except httpx.HTTPError as exc:status=type(exc).__name__;length=0
                elapsed=time.perf_counter()-begun;m=metrics[name];m['latencies'].append(elapsed*1000);m['statuses'][status]+=1;m['bytes']+=length
                if a.rps:await asyncio.sleep(max(0,a.concurrency/a.rps-elapsed))
        monitoring=asyncio.create_task(monitor())
        await asyncio.gather(*(worker(i) for i in range(a.concurrency)))
        elapsed=time.perf_counter()-start;running=False;await monitoring
        # Dedicated benchmark notes are hard-deleted directly from the isolated DB,
        # keeping dataset size stable between before/after measurements.
        if writers:
            conn=await psycopg.AsyncConnection.connect(runtime['databases']['performance'].replace('postgresql+psycopg:','postgresql:'),autocommit=True)
            try:await conn.execute('DELETE FROM memos WHERE id=ANY(%s)',(writers,))
            finally:await conn.close()
    combined=[value for m in metrics.values() for value in m['latencies']];statuses=sum((m['statuses'] for m in metrics.values()),collections.Counter());bad=sum(v for k,v in statuses.items() if not k.startswith('2'))
    report={'name':a.name,'concurrency':a.concurrency,'requested_duration_s':a.duration,'measured_duration_s':round(elapsed,2),'target_rps':a.rps or None,'requests':len(combined),'rps':round(len(combined)/elapsed,2),'p50_ms':percentile(combined,.5),'p95_ms':percentile(combined,.95),'p99_ms':percentile(combined,.99),'error_rate':round(bad/max(1,len(combined)),6),'statuses':dict(statuses),'failures':failures,'resources':samples,'endpoints':{name:{'requests':len(m['latencies']),'p50_ms':percentile(m['latencies'],.5),'p95_ms':percentile(m['latencies'],.95),'p99_ms':percentile(m['latencies'],.99),'statuses':dict(m['statuses']),'response_bytes_mean':round(m['bytes']/max(1,len(m['latencies'])))} for name,m in metrics.items()}}
    (target/f'{a.name}.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in {'resources','endpoints'}},ensure_ascii=False))
    print('Endpoint p95:',{k:v['p95_ms'] for k,v in report['endpoints'].items()})
asyncio.run(main())
