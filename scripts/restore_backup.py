"""Offline restore wrapper; see docs/备份与恢复.md."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from app.restore_backup import restore,main
if __name__=='__main__':main()
