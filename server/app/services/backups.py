"""Encrypted full backups. The recovery key is separate from backup archives."""
from __future__ import annotations
import base64,hashlib,json,os,re,shutil,sqlite3,subprocess,tarfile,tempfile,threading,uuid
from pathlib import Path
from datetime import datetime,timezone
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
from sqlalchemy.engine import make_url
from ..config import settings
from ..db import engine

_lock=threading.Lock()
NAME=re.compile(r'^backup-[0-9TZ-]+-[a-f0-9]{8}$')
BLOCK=1024*1024


def directory():
    root=settings.backup_dir.resolve();storage=settings.storage_dir.resolve()
    if root==storage or root.is_relative_to(storage):raise RuntimeError('备份目录必须放在附件目录之外')
    root.mkdir(parents=True,exist_ok=True,mode=0o700);root.chmod(0o700)
    return root


def key_file():
    path=directory()/'recovery.key'
    if not path.exists():
        try:
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as stream:stream.write(base64.urlsafe_b64encode(os.urandom(32)))
        except FileExistsError:pass
    path.chmod(0o600)
    return path


def archive_path(name):
    if not NAME.fullmatch(name):raise ValueError('备份编号不合法')
    return directory()/(name+'.wbbackup')


def list_backups():
    items=[]
    for path in directory().glob('backup-*.json'):
        try:
            item=json.loads(path.read_text())
            if archive_path(item['id']).is_file():items.append(item)
        except (ValueError,OSError,KeyError):continue
    return sorted(items,key=lambda x:x['created_at'],reverse=True)


def _hash(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(BLOCK),b''):digest.update(chunk)
    return digest.hexdigest()


def _encrypt(source,destination,key):
    nonce=os.urandom(12);cipher=Cipher(algorithms.AES(key),modes.GCM(nonce)).encryptor()
    with source.open('rb') as incoming,destination.open('wb') as outgoing:
        outgoing.write(b'WBK1'+nonce)
        for chunk in iter(lambda:incoming.read(BLOCK),b''):outgoing.write(cipher.update(chunk))
        outgoing.write(cipher.finalize());outgoing.write(cipher.tag)
    destination.chmod(0o600)


def decrypt_archive(archive,destination,key):
    size=archive.stat().st_size
    if size<32:raise ValueError('备份文件不完整')
    with archive.open('rb') as incoming,destination.open('wb') as outgoing:
        if incoming.read(4)!=b'WBK1':raise ValueError('备份文件格式不正确')
        nonce=incoming.read(12);incoming.seek(-16,2);tag=incoming.read(16);incoming.seek(16)
        cipher=Cipher(algorithms.AES(key),modes.GCM(nonce,tag)).decryptor();remaining=size-32
        while remaining:
            chunk=incoming.read(min(BLOCK,remaining))
            if not chunk:raise ValueError('备份文件不完整')
            remaining-=len(chunk);outgoing.write(cipher.update(chunk))
        outgoing.write(cipher.finalize())


def create_backup(progress=lambda done,total:None):
    if not _lock.acquire(blocking=False):raise RuntimeError('已有备份正在执行')
    name='backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
    target=archive_path(name);pending=target.with_suffix('.partial')
    try:
        key=base64.urlsafe_b64decode(key_file().read_bytes())
        with tempfile.TemporaryDirectory(prefix='.backup-',dir=directory()) as temporary:
            work=Path(temporary);work.chmod(0o700);database=work/'database.dump'
            url=make_url(settings.database_url)
            if settings.is_sqlite:
                destination=sqlite3.connect(database)
                connection=engine.raw_connection()
                try:connection.driver_connection.backup(destination)
                finally:destination.close();connection.close()
            else:
                env=os.environ.copy();env['PGPASSWORD']=url.password or ''
                subprocess.run(['pg_dump','-h',url.host or 'localhost','-p',str(url.port or 5432),'-U',url.username or '', '-Fc','-f',str(database),url.database or ''],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=600)
            progress(10,100)
            storage=settings.storage_dir.resolve();files=sorted(p for p in storage.rglob('*') if p.is_file() and not p.is_symlink()) if storage.exists() else []
            manifest={'id':name,'format':1,'database_kind':'sqlite' if settings.is_sqlite else 'postgresql','created_at':datetime.now(timezone.utc).isoformat(),'files':{}}
            recovery=work/'env.json';recovery.write_text(json.dumps({'WB_ENCRYPTION_KEY':settings.encryption_key}));recovery.chmod(0o600)
            packed=work/'contents.tar.gz'
            with tarfile.open(packed,'w:gz') as archive:
                for path,label in [(database,'database.dump'),(recovery,'recovery/env.json')]+[(p,'storage/'+p.relative_to(storage).as_posix()) for p in files]:
                    if not path.exists():raise RuntimeError('附件在备份过程中发生变化，请重试备份')
                    manifest['files'][label]={'sha256':_hash(path),'size':path.stat().st_size}
                    archive.add(path,arcname=label,recursive=False)
                manifest_path=work/'manifest.json';manifest_path.write_text(json.dumps(manifest,ensure_ascii=False));archive.add(manifest_path,arcname='manifest.json')
            progress(70,100);_encrypt(packed,pending,key);pending.replace(target)
            verify_backup(name)
            item={k:v for k,v in manifest.items() if k!='files'};item['verified']=True;item.update(size=target.stat().st_size,file_count=len(files),sha256=_hash(target))
            (directory()/(name+'.json')).write_text(json.dumps(item,ensure_ascii=False));(directory()/(name+'.json')).chmod(0o600)
        # Only managed complete archives are eligible for retention.
        for old in list_backups()[settings.backup_keep:]:
            archive_path(old['id']).unlink(missing_ok=True);(directory()/(old['id']+'.json')).unlink(missing_ok=True)
        progress(100,100);return item
    except Exception:
        target.unlink(missing_ok=True);(directory()/(name+'.json')).unlink(missing_ok=True)
        raise
    finally:
        pending.unlink(missing_ok=True);_lock.release()


def unpack_verified(archive,key,work):
    """Authenticate the entire encrypted stream before opening the contained tar."""
    packed=work/'contents.tar.gz';decrypt_archive(archive,packed,key)
    extracted=work/'verified';extracted.mkdir()
    with tarfile.open(packed,'r:gz') as tar:
        for member in tar:
            relative=Path(member.name)
            if relative.is_absolute() or '..' in relative.parts or not member.isfile():raise ValueError('备份包含不安全的文件路径')
            target=extracted/relative;target.parent.mkdir(parents=True,exist_ok=True)
            incoming=tar.extractfile(member)
            if incoming is None:raise ValueError('备份内容无法读取')
            with incoming,target.open('wb') as outgoing:shutil.copyfileobj(incoming,outgoing,BLOCK)
            target.chmod(0o600)
    manifest=json.loads((extracted/'manifest.json').read_text())
    for label,entry in manifest['files'].items():
        path=extracted/label
        if not path.resolve().is_relative_to(extracted.resolve()) or path.stat().st_size!=entry['size'] or _hash(path)!=entry['sha256']:raise ValueError('备份完整性校验失败')
    return extracted,manifest


def verify_backup(name):
    with tempfile.TemporaryDirectory(prefix='.verify-',dir=directory()) as temporary:
        work=Path(temporary);work.chmod(0o700)
        extracted,manifest=unpack_verified(archive_path(name),base64.urlsafe_b64decode(key_file().read_bytes()),work)
        if manifest['database_kind']=='sqlite':
            connection=sqlite3.connect(extracted/'database.dump')
            try:
                if connection.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('数据库完整性检查失败')
            finally:connection.close()
        else:subprocess.run(['pg_restore','--list',str(extracted/'database.dump')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=60)
        return {'id':name,'verified':True,'files':len(manifest['files'])}