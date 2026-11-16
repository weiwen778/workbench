"""Read-only system sampling. No subprocesses, Docker socket, shell, or remote URLs."""
from __future__ import annotations
import copy,json,math,os,platform,threading,time
from collections import deque
from pathlib import Path
from datetime import datetime,timezone
import psutil

INTERVAL=5
HISTORY_SIZE=180
MAX_FILE_BYTES=262144

def _read(path):
    try:return Path(path).read_text().strip()
    except OSError:return None

def in_container():
    return Path('/.dockerenv').exists() or Path('/run/.containerenv').exists() or bool(os.environ.get('container'))

def cgroup_memory(host_total):
    current=_read('/sys/fs/cgroup/memory.current') or _read('/sys/fs/cgroup/memory/memory.usage_in_bytes')
    maximum=_read('/sys/fs/cgroup/memory.max') or _read('/sys/fs/cgroup/memory/memory.limit_in_bytes')
    try:
        used=int(current);limit=int(maximum) if maximum and maximum!='max' else host_total
        limit=min(limit,host_total)
        return {'used':used,'total':limit,'available':max(0,limit-used),'percent':round(used/limit*100,1) if limit else None,'limited':maximum not in (None,'max') and int(maximum)<host_total}
    except (TypeError,ValueError):return None

def cgroup_cpu():
    maximum=_read('/sys/fs/cgroup/cpu.max')
    try:
        if maximum:
            quota,period=maximum.split();cores=float(quota)/float(period) if quota!='max' else None
            usage=dict(line.split() for line in (_read('/sys/fs/cgroup/cpu.stat') or '').splitlines()).get('usage_usec')
            return cores,float(usage)/1_000_000 if usage is not None else None
        quota=float(_read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') or -1);period=float(_read('/sys/fs/cgroup/cpu/cpu.cfs_period_us') or 100000)
        usage=_read('/sys/fs/cgroup/cpuacct/cpuacct.usage')
        return quota/period if quota>0 else None,float(usage)/1_000_000_000 if usage else None
    except (ValueError,ZeroDivisionError):return None,None

def _rate(current,previous,elapsed,precision=2):
    if current is None or previous is None or elapsed<=0 or current<previous:return None
    return round((current-previous)/elapsed,precision)

class Sampler:
    def __init__(self,host_root:Path|None=None,paths:list[tuple[str,Path]]|None=None,interval=INTERVAL):
        self.host_root=host_root;self.paths=paths or [('系统磁盘',Path('/'))]
        self.container=in_container() and host_root is None
        self.interval=interval;self._lock=threading.Lock();self._history=deque(maxlen=HISTORY_SIZE)
        self._latest=None;self._error=None;self._previous=None;self._thread=None;self._stop=threading.Event();self._started=time.monotonic()
    def start(self):
        with self._lock:
            if self._thread is not None:return
            self._thread=threading.Thread(target=self._run,name='server-metrics',daemon=True);self._thread.start()
    def stop(self):
        self._stop.set()
        if self._thread is not None:self._thread.join(timeout=2)
    def _run(self):
        while not self._stop.is_set():
            try:self.collect()
            except Exception:
                with self._lock:self._error='服务器指标采集暂不可用，请检查系统权限或采集器状态'
            self._stop.wait(self.interval)
    def collect(self):
        now=time.time();monotonic=time.monotonic();previous=self._previous or {};elapsed=monotonic-previous.get('at',monotonic)
        notes=[];logical=psutil.cpu_count() or 1
        global_cpu=psutil.cpu_percent(interval=None)
        memory=psutil.virtual_memory();swap=psutil.swap_memory()
        quota,usage=cgroup_cpu() if self.container else (None,None)
        cpu_percent=_rate(usage,previous.get('cpu_usage'),elapsed,precision=8)
        if self.container:
            capacity=quota or logical
            cpu_percent=round(cpu_percent/capacity*100,1) if cpu_percent is not None else None
            mem=cgroup_memory(memory.total)
            if mem is None:notes.append('容器未提供可用的内存计数，内存指标暂不可用')
            load=None;swap_data=None
        else:
            capacity=logical;cpu_percent=global_cpu if self._previous else None
            mem={'used':memory.total-memory.available,'total':memory.total,'available':memory.available,'percent':round((memory.total-memory.available)/memory.total*100,1)}
            try:load=[round(n,2) for n in os.getloadavg()]
            except (OSError,AttributeError):load=None
            swap_data={'used':swap.used,'total':swap.total,'percent':swap.percent}
        try:
            per_nic=psutil.net_io_counters(pernic=True,nowrap=True)
            names=[n for n in per_nic if n!='lo' and not n.startswith(('veth','docker','br-','virbr'))]
            if not names:names=[n for n in per_nic if n!='lo']
            received=sum(per_nic[n].bytes_recv for n in names);sent=sum(per_nic[n].bytes_sent for n in names)
            network={'received_bytes':received,'sent_bytes':sent,'receive_bps':_rate(received,previous.get('received'),elapsed),'send_bps':_rate(sent,previous.get('sent'),elapsed),'interfaces':names[:16]}
        except (OSError,RuntimeError):network=None;received=sent=None;notes.append('网络指标暂不可用')
        disks=[];seen=set()
        paths=[('系统磁盘',self.host_root)] if self.host_root else self.paths
        for label,path in paths:
            try:
                identity=path.stat().st_dev
                if identity in seen:continue
                seen.add(identity);d=psutil.disk_usage(str(path));disks.append({'label':label,'total':d.total,'used':d.used,'free':d.free,'percent':d.percent})
            except OSError:notes.append(label+'容量暂不可用')
        io_data=None;read_bytes=write_bytes=None
        if not self.container:
            try:
                io=psutil.disk_io_counters(nowrap=True)
                if io:
                    read_bytes=io.read_bytes;write_bytes=io.write_bytes
                    io_data={'read_bps':_rate(read_bytes,previous.get('disk_read'),elapsed),'write_bps':_rate(write_bytes,previous.get('disk_write'),elapsed)}
            except (OSError,RuntimeError):pass
        hostname=platform.node()
        if self.host_root:hostname=_read(self.host_root/'etc/hostname') or hostname
        wsl='microsoft' in platform.release().lower()
        sample={'sampled_at':datetime.fromtimestamp(now,timezone.utc).isoformat(),'timestamp':now,'scope':'container' if self.container else 'host',
                'environment':'Docker 容器' if self.container else 'WSL2' if wsl else platform.system(),'hostname':hostname[:120],
                'cpu':{'percent':cpu_percent,'logical_cores':logical,'capacity_cores':capacity},'memory':mem,'swap':swap_data,'load_average':load,
                'uptime_seconds':max(0,now-psutil.boot_time()) if not self.container else None,'network':network,'disks':disks,'disk_io':io_data,'notes':notes}
        history={'timestamp':now,'cpu_percent':cpu_percent,'memory_percent':mem['percent'] if mem else None,'disk_percent':disks[0]['percent'] if disks else None,
                 'receive_bps':network['receive_bps'] if network else None,'send_bps':network['send_bps'] if network else None}
        with self._lock:self._latest=sample;self._error=None;self._history.append(history)
        self._previous={'at':monotonic,'cpu_usage':usage,'received':received,'sent':sent,'disk_read':read_bytes,'disk_write':write_bytes}
        return sample
    def snapshot(self):
        with self._lock:return {'latest':copy.deepcopy(self._latest),'history':list(self._history),'interval_seconds':self.interval,'retention_seconds':HISTORY_SIZE*self.interval,'collection_error':self._error}

_instance=None
_instance_lock=threading.Lock()
def local_sampler():
    global _instance
    with _instance_lock:
        if _instance is None:
            from ..config import settings
            paths=[('系统磁盘',Path('/')),('附件存储磁盘',settings.storage_dir),('备份存储磁盘',settings.backup_dir)]
            _instance=Sampler(paths=paths);_instance.start()
        return _instance

def start():local_sampler()
def stop():
    global _instance
    with _instance_lock:
        if _instance:_instance.stop();_instance=None

def validate_document(document):
    def number(value,nullable=True):
        if value is None and nullable:return None
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:raise ValueError('invalid number')
        return value
    def record(raw,keys,nullable=False):
        if raw is None and nullable:return None
        if not isinstance(raw,dict) or not set(keys).issubset(raw):raise ValueError('invalid metric')
        return {k:number(raw[k]) for k in keys}
    def text(value,limit):
        if not isinstance(value,str) or len(value)>limit:raise ValueError('invalid text')
        return value
    if not isinstance(document,dict) or not isinstance(document.get('latest'),dict):raise ValueError('invalid metrics')
    raw=document['latest'];timestamp=number(raw.get('timestamp'),False)
    if timestamp>time.time()+30 or raw.get('scope')!='host':raise ValueError('invalid metrics')
    cpu=record(raw.get('cpu'),['percent','logical_cores','capacity_cores'])
    memory=record(raw.get('memory'),['used','total','available','percent'],True)
    network=record(raw.get('network'),['received_bytes','sent_bytes','receive_bps','send_bps'],True)
    if network is not None:
        interfaces=raw['network'].get('interfaces',[])
        if not isinstance(interfaces,list) or len(interfaces)>16:raise ValueError('invalid interfaces')
        network['interfaces']=[text(n,80) for n in interfaces]
    disks=raw.get('disks',[])
    if not isinstance(disks,list) or len(disks)>8:raise ValueError('invalid disks')
    disk_data=[{**record(d,['total','used','free','percent']),'label':text(d.get('label'),80)} for d in disks]
    load=raw.get('load_average')
    if load is not None:
        if not isinstance(load,list) or len(load)!=3:raise ValueError('invalid load')
        load=[number(v,False) for v in load]
    notes=raw.get('notes',[])
    if not isinstance(notes,list) or len(notes)>16:raise ValueError('invalid notes')
    latest={'timestamp':timestamp,'sampled_at':text(raw.get('sampled_at'),80),'scope':'host','environment':text(raw.get('environment'),80),
            'hostname':text(raw.get('hostname'),120),'cpu':cpu,'memory':memory,'network':network,'disks':disk_data,'load_average':load,
            'swap':record(raw.get('swap'),['used','total','percent'],True),'disk_io':record(raw.get('disk_io'),['read_bps','write_bps'],True),
            'uptime_seconds':number(raw.get('uptime_seconds')),'notes':[text(n,200) for n in notes]}
    history=document.get('history',[])
    if not isinstance(history,list) or len(history)>HISTORY_SIZE:raise ValueError('invalid history')
    keys=['timestamp','cpu_percent','memory_percent','disk_percent','receive_bps','send_bps']
    return {'latest':latest,'history':[record(point,keys) for point in history],'interval_seconds':INTERVAL,'retention_seconds':HISTORY_SIZE*INTERVAL}

def read_snapshot():
    from ..config import settings
    warnings=[];document=None;source='local'
    if settings.host_metrics_file:
        try:
            path=settings.host_metrics_file
            with path.open('rb') as stream:raw=stream.read(MAX_FILE_BYTES+1)
            if len(raw)>MAX_FILE_BYTES:raise ValueError('metrics too large')
            document=validate_document(json.loads(raw));source='host_collector'
        except (OSError,ValueError,TypeError):warnings.append('宿主机采集器尚未就绪，当前显示工作台运行环境指标')
    if document is None:document=local_sampler().snapshot()
    if document.get('collection_error'):warnings.append(document['collection_error'])
    latest=document.get('latest');age=max(0,time.time()-latest['timestamp']) if latest else None
    stale=bool(age is not None and age>INTERVAL*4)
    if stale:warnings.append('采集已中断，以下保留最近一次数据，请检查采集器状态')
    return {**document,'source':source,'stale':stale,'age_seconds':round(age,1) if age is not None else None,'warnings':warnings,
            'status':'error' if document.get('collection_error') else 'warming' if latest is None else 'stale' if stale else 'ok','api_uptime_seconds':max(0,time.time()-psutil.Process().create_time()),
            'api_memory_bytes':psutil.Process().memory_info().rss}

# Run as a host-network/PID read-only sidecar. It exposes no listening ports.
def collector(directory:Path,host_root:Path|None=None):
    directory.mkdir(parents=True,exist_ok=True);sampler=Sampler(host_root=host_root)
    try:
        while True:
            sampler.collect();payload=json.dumps(sampler.snapshot(),ensure_ascii=False,allow_nan=False).encode()
            temp=directory/'current.json.tmp'
            fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
            with os.fdopen(fd,'wb') as output:output.write(payload)
            os.replace(temp,directory/'current.json')
            time.sleep(INTERVAL)
    except KeyboardInterrupt:return

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True);parser.add_argument('--host-root',type=Path)
    args=parser.parse_args();collector(args.output_dir,args.host_root)
