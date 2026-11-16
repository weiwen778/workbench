"""Offline restore into an empty database/storage directory. Never overwrites data.

Run server/.venv/bin/python scripts/restore_backup.py ARCHIVE --key-file KEY
    --database-url URL --storage-dir DIRECTORY --recovery-env PATH
Stop the target service first. Create an empty PostgreSQL database before restoring.
"""
import argparse,base64,json,os,shutil,sqlite3,subprocess,sys,tempfile
from pathlib import Path
from sqlalchemy import create_engine,inspect
from sqlalchemy.engine import make_url
from app.services.backups import unpack_verified


def restore(archive,key_file,database_url,storage_dir,recovery_env):
    destination=Path(storage_dir).resolve();recovery=Path(recovery_env).resolve();url=make_url(database_url)
    if destination.exists() and any(destination.iterdir()):raise RuntimeError('附件恢复目录必须为空，现有文件不会覆盖')
    if recovery.exists():raise RuntimeError('恢复密钥配置输出文件已存在，不会覆盖')
    engine=create_engine(database_url)
    if inspect(engine).get_table_names():raise RuntimeError('目标数据库必须为空，现有数据不会覆盖')
    engine.dispose()
    with tempfile.TemporaryDirectory(prefix='wb_restore_') as temporary:
        work=Path(temporary);work.chmod(0o700)
        extracted,manifest=unpack_verified(Path(archive),base64.urlsafe_b64decode(Path(key_file).read_bytes()),work)
        sqlite=url.get_backend_name()=='sqlite'
        if sqlite!=(manifest['database_kind']=='sqlite'):raise RuntimeError('备份数据库类型与目标不一致')
        source=extracted/'storage'
        destination.mkdir(parents=True,exist_ok=True,mode=0o700)
        if source.exists():shutil.copytree(source,destination,dirs_exist_ok=True)
        if sqlite:
            target=Path(url.database).resolve();target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(extracted/'database.dump',target);target.chmod(0o600)
        else:
            env=os.environ.copy();env['PGPASSWORD']=url.password or ''
            subprocess.run(['pg_restore','--exit-on-error','--single-transaction','--no-owner','--no-acl','-h',url.host or 'localhost','-p',str(url.port or 5432),'-U',url.username or '', '-d',url.database or '',str(extracted/'database.dump')],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=600)
        # Old sessions/tokens and queued work must not silently become active again.
        from sqlalchemy import update
        from app.models import UserSession,AgentToken,BackgroundJob,utcnow
        restored_engine=create_engine(database_url)
        tables=set(inspect(restored_engine).get_table_names())
        with restored_engine.begin() as connection:
            for model in (UserSession,AgentToken):
                if model.__tablename__ in tables:connection.execute(update(model).values(revoked_at=utcnow()))
            if BackgroundJob.__tablename__ in tables:connection.execute(update(BackgroundJob).where(BackgroundJob.status.in_(['queued','running'])).values(status='failed',error='从备份恢复后已停止，请核对后手动重试'))
        restored_engine.dispose()
        recovery.parent.mkdir(parents=True,exist_ok=True)
        config=json.loads((extracted/'recovery/env.json').read_text())
        fd=os.open(recovery,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as stream:
            for name,value in config.items():
                if value:stream.write(name+'='+str(value)+'\n')
        return {'restored':True,'files':len(manifest['files']),'recovery_env':str(recovery)}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--key-file',required=True,type=Path)
    parser.add_argument('--database-url',default=os.environ.get('WB_RESTORE_DATABASE_URL'));parser.add_argument('--storage-dir',required=True,type=Path);parser.add_argument('--recovery-env',required=True,type=Path)
    args=parser.parse_args()
    if not args.database_url:parser.error('请通过 WB_RESTORE_DATABASE_URL 或 --database-url 指定空数据库')
    print(json.dumps(restore(args.archive,args.key_file,args.database_url,args.storage_dir,args.recovery_env),ensure_ascii=False))

if __name__=='__main__':main()
