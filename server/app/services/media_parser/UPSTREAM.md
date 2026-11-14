# 上游快照说明

本目录的解析器代码来自开源项目 **media-parser**：

- 仓库：https://github.com/ucmao/media-parser
- 许可证：MIT（见同目录 `LICENSE`，版权归 ucmao）
- 快照分支：`main`
- 快照 commit：`f32496cc3736621fff75c2807e3cee23112444bc`
- 快照日期：2026-11-14

上游 README 已公告：项目即将停止维护，并计划在 **2026-12-01 前移除大部分平台解析源码**。
本快照是为了在那之前保留可用的解析实现。后续平台接口变化需要在本仓库内自行维护。

## 保留了哪些内容

只保留解析层，不包含上游的 Flask 应用、管理后台、SQLite 数据库、代理管理器和 Web 页面：

- `src/parsers/`：全部平台 parser 文件（工作台默认只载入抖音、小红书、快手）
- `src/parser_factory.py`
- `src/utils/cookie_manager.py`、`src/utils/parser_transport.py`
- `utils/web_fetcher.py`、`utils/html_video_extractor.py`
- `utils/signer/`
- `configs/`（域名表、UA、日志适配）

## 本地修改

1. 绝对导入改为包内相对导入。
2. `src/parser_factory.py` 改为显式载入解析器模块，默认只载入三个平台，避免导入无关 parser。
3. `src/utils/cookie_manager.py` 删除数据库读取，只读取环境变量。
4. `configs/logging_config.py` 改为仅返回命名空间 logger，不创建日志文件、不调用 `logging.basicConfig`。
5. 删除 `proxy_manager.py`、`cookie_prober.py`、`cookie_registry.py`、`cookie_samples.py`、`table_query.py`、`src/api/`、`src/web/`。

## 维护提醒

- 抖音依赖 `mini-racer` 执行 JS 生成 `a_bogus` 签名，平台风控变化时可能概率性 403。
- 小红书、快手在触发登录/安全校验时需要环境变量 Cookie。
- 升级依赖或修改 parser 时，请先跑 `server/tests/test_media.py`，再用真实链接手动验证三个平台。
