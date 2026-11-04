"""Background worker for the isolated export browser regression only."""
import os, sys, time
from pathlib import Path
assert os.environ.get('WB_ENV') == 'test'
assert 'wb_modal_layout_' in os.environ.get('WB_DATABASE_URL', '')
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'server'))
from app.services.jobs import run_next
while True:
    run_next()
    time.sleep(.1)
