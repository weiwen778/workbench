FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

ARG APT_MIRROR=deb.debian.org
RUN sed -i "s|http://deb.debian.org|https://${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=2 -o Acquire::https::Timeout=30 update \
    && apt-get -o Acquire::Retries=2 -o Acquire::https::Timeout=30 install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r requirements.txt

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

ENV WB_STORAGE_DIR=/data/storage

EXPOSE 8000

# 启动前执行数据库迁移；迁移失败则容器不启动，避免半套结构对外服务
# 只启用 --proxy-headers，具体信任哪些地址由 FORWARDED_ALLOW_IPS 环境变量决定（compose 里指向反代容器 IP）。
# 不要在这里写 --forwarded-allow-ips='*'：那会让任意来源伪造 X-Forwarded-For 绕过按 IP 的限流与登录锁定。
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
