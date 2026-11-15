import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import Settings


def test_database_connection_encodes_reserved_password_characters():
    password = "a%2F@:/+#b"
    settings = Settings(_env_file=None, database_url=None, db_host="db", db_user="workbench",
                        db_password=password, db_name="workbench")

    url = make_url(settings.database_url)
    assert url.host == "db"
    assert url.password == password


def test_explicit_database_url_overrides_connection_parts():
    settings = Settings(_env_file=None, database_url="sqlite:///./explicit.db", db_host="db")
    assert settings.database_url == "sqlite:///./explicit.db"


def test_alembic_accepts_encoded_database_password():
    server_dir = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "2cb67a515f96", "--sql"],
        cwd=server_dir,
        env={**os.environ, "WB_DATABASE_URL": "postgresql+psycopg://workbench:a%40b%25@db/workbench"},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "CREATE TABLE" in result.stdout
