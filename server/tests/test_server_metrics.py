import json,time
from pathlib import Path
from types import SimpleNamespace
import pytest
from app.services import server_metrics as service
from app.config import settings


def sample():
 return {'sampled_at':'2026-11-04T00:00:00+00:00','timestamp':time.time(),'scope':'host','environment':'Linux','hostname':'test-server','cpu':{'percent':25.0,'logical_cores':2,'capacity_cores':2},'memory':{'used':500,'total':1000,'available':500,'percent':50},'swap':{'used':0,'total':0,'percent':0},'load_average':[0.1,0.2,0.3],'uptime_seconds':12345,'network':{'received_bytes':1000,'sent_bytes':500,'receive_bps':100,'send_bps':50,'interfaces':['eth0']},'disks':[{'label':'系统磁盘','used':400,'total':1000,'free':600,'percent':40}],'disk_io':{'read_bps':10,'write_bps':20},'notes':[]}
def point(timestamp):return {'timestamp':timestamp,'cpu_percent':25,'memory_percent':50,'disk_percent':40,'receive_bps':100,'send_bps':50}
def document():
 latest=sample();return {'latest':latest,'history':[point(latest['timestamp'])],'interval_seconds':5}
class FakeSampler:
 def snapshot(self):return document()


def test_metrics_requires_login(client):
 assert client.get('/api/v1/system/metrics').status_code==401
 assert client.get('/api/v1/health').status_code==200
 assert 'hostname' not in client.get('/api/v1/health').text

def test_authenticated_metrics_and_no_external_access(auth,monkeypatch):
 monkeypatch.setattr(settings,'host_metrics_file',None);monkeypatch.setattr(service,'local_sampler',lambda:FakeSampler())
 response=auth.get('/api/v1/system/metrics');assert response.status_code==200
 assert response.json()['latest']['cpu']['percent']==25
 assert response.json()['source']=='local'


def test_host_snapshot_whitelisting_and_stale_state(auth,monkeypatch,tmp_path):
 path=tmp_path/'current.json';value=document();value['api_key']='do-not-leak';value['latest']['password']='do-not-leak';value['latest']['cpu']['password']='do-not-leak';value['history'][0]['password']='do-not-leak';path.write_text(json.dumps(value))
 monkeypatch.setattr(settings,'host_metrics_file',path)
 response=auth.get('/api/v1/system/metrics');assert response.status_code==200,response.text
 assert response.json()['source']=='host_collector' and not response.json()['stale'];assert 'do-not-leak' not in response.text
 value['latest']['timestamp']=time.time()-120;path.write_text(json.dumps(value));result=auth.get('/api/v1/system/metrics').json();assert result['stale'] and result['status']=='stale' and result['warnings']

@pytest.mark.parametrize('raw',['broken-json','{}','[]',json.dumps({'latest':{'scope':'host','timestamp':float('nan')}}),'x'*(service.MAX_FILE_BYTES+1)])
def test_invalid_missing_or_oversized_file_falls_back(auth,monkeypatch,tmp_path,raw):
 path=tmp_path/'current.json';path.write_text(raw);monkeypatch.setattr(settings,'host_metrics_file',path);monkeypatch.setattr(service,'local_sampler',lambda:FakeSampler())
 response=auth.get('/api/v1/system/metrics');assert response.status_code==200,response.text
 assert response.json()['source']=='local' and response.json()['warnings']
 path.unlink();assert auth.get('/api/v1/system/metrics').status_code==200


def test_counter_rates_and_reset():
 assert service._rate(600,100,5)==100
 assert service._rate(1,100,5) is None
 assert service._rate(1,None,5) is None
 assert service._rate(1,0,0) is None


def test_sampler_first_sample_warming_and_bounded_history(monkeypatch,tmp_path):
 monkeypatch.setattr(service,'in_container',lambda:False)
 monkeypatch.setattr(service.psutil,'cpu_percent',lambda interval:12.5)
 sampler=service.Sampler(paths=[('磁盘',tmp_path)])
 assert sampler.collect()['cpu']['percent'] is None
 assert sampler.collect()['cpu']['percent']==12.5
 assert sampler.snapshot()['latest']['scope']=='host'
 for i in range(200):sampler._history.append(point(time.time()+i))
 assert len(sampler.snapshot()['history'])==service.HISTORY_SIZE
 assert sampler.snapshot()['latest']['disks'][0]['total']>0


def test_container_scope_uses_cgroup_not_host_memory(monkeypatch,tmp_path):
 monkeypatch.setattr(service,'in_container',lambda:True)
 values={'/sys/fs/cgroup/memory.current':'100','/sys/fs/cgroup/memory.max':'200','/sys/fs/cgroup/cpu.max':'50000 100000','/sys/fs/cgroup/cpu.stat':'usage_usec 100000'}
 monkeypatch.setattr(service,'_read',lambda path:values.get(str(path)))
 sampler=service.Sampler(paths=[('磁盘',tmp_path)]);first=sampler.collect()
 assert first['scope']=='container' and first['memory']['total']==200 and first['memory']['percent']==50
 assert first['cpu']['capacity_cores']==0.5 and first['cpu']['percent'] is None
 assert first['load_average'] is None and first['uptime_seconds'] is None and first['disk_io'] is None


def test_host_collector_overrides_container_scope(monkeypatch,tmp_path):
 monkeypatch.setattr(service,'in_container',lambda:True)
 sampler=service.Sampler(host_root=tmp_path);value=sampler.collect();assert value['scope']=='host'
 validated=service.validate_document(sampler.snapshot());assert validated['latest']['scope']=='host'
 assert validated['history'][0]['cpu_percent'] is None


def test_invalid_future_and_nonfinite_values():
 value=document();value['latest']['timestamp']=time.time()+1000
 with pytest.raises(ValueError):service.validate_document(value)
 value=document();value['latest']['cpu']['percent']=float('nan')
 with pytest.raises(ValueError):service.validate_document(value)
 value=document();value['history']=[point(time.time())]*(service.HISTORY_SIZE+1)
 with pytest.raises(ValueError):service.validate_document(value)

def test_container_small_cpu_usage_is_not_rounded_to_zero(monkeypatch,tmp_path):
 monkeypatch.setattr(service,'in_container',lambda:True)
 monkeypatch.setattr(service,'cgroup_cpu',lambda:(1,10.0001))
 sampler=service.Sampler(paths=[('disk',tmp_path)])
 sampler._previous={'at':service.time.monotonic()-5,'cpu_usage':10}
 assert sampler.collect()['cpu']['percent'] is not None
 # A 0.004-second increment over 5 seconds must display 0.1%, not 0%.
 sampler._previous={'at':service.time.monotonic()-5,'cpu_usage':9.9961}
 assert sampler.collect()['cpu']['percent']==0.1
