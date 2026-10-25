FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt "psycopg[binary]>=3.1" "alembic>=1.13"

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

ENV WB_STORAGE_DIR=/data/storage

EXPOSE 8000

# 启动前执行数据库迁移；迁移失败则容器不启动，避免半套结构对外服务
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
