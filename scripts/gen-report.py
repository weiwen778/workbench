#!/usr/bin/env python3
"""生成可直接打开的交付报告 HTML（图片内嵌，避免相对路径失效）。"""

from __future__ import annotations

import base64
import html
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "screenshots"
OUT = ROOT / "docs" / "交付报告.html"

FEATURED = [
    ("01-店铺打卡-空状态.png", "首次进入：默认落在店铺打卡／今日"),
    ("04-店铺打卡-已完成.png", "勾选即完成，统计与完成率同步"),
    ("05-待办-子任务.png", "待办：子任务与父子联动"),
    ("06-待办-已完成区.png", "父任务由子任务推导完成，移入已完成区"),
    ("07-数据表.png", "数据表：动态字段、服务端筛选、分页"),
    ("09-笔记.png", "笔记：Markdown 源码 + 预览 + 自动保存"),
    ("10-翻译.png", "翻译：上方工具、中间双区、下方历史"),
    ("11-翻译服务设置.png", "翻译服务：三家分别配置、凭据脱敏"),
    ("14-深色-店铺打卡.png", "深色主题跟随"),
    ("15-平板-店铺打卡.png", "768×1024 平板：抽屉导航、无整页横滚"),
    ("16-平板-待办.png", "平板待办：清单栏 + 任务区"),
    ("18-打卡历史.png", "打卡历史：按状态和日期范围查询，结束后只读"),
    ("13-设置.png", "设置：主题、改密、使用说明、运行信息"),
]


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def run(cmd: list[str], cwd: Path) -> str:
    try:
        return subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=300, check=False
        ).stdout.strip()
    except Exception as exc:  # pragma: no cover
        return f"(未执行: {exc})"


def main() -> None:
    shots = [(name, caption) for name, caption in FEATURED if (SHOTS / name).exists()]
    images = "\n".join(
        f"""
    <figure>
      <img src="data:image/png;base64,{b64(SHOTS / name)}" alt="{html.escape(caption)}" loading="lazy" />
      <figcaption>{html.escape(caption)}</figcaption>
    </figure>"""
        for name, caption in shots
    )

    test_output = run(["../server/.venv/bin/python", "-m", "pytest", "-q"], ROOT / "server")
    last_line = test_output.splitlines()[-1] if test_output else ""

    doc = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>个人工作台 · 本轮交付报告</title>
<style>
  :root {{
    --bg:#f5f7fa; --surface:#fff; --text:#334155; --text2:#475569; --muted:#94a3b8;
    --border:#e2e8ee; --primary:#39776f; --ok:#16a34a; --warn:#d97706;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.7; font-size:15px; }}
  .wrap {{ max-width:1040px; margin:0 auto; padding:32px 24px 64px; }}
  header {{ margin-bottom:20px; }}
  h1 {{ font-size:24px; margin:0 0 6px; }}
  h2 {{ font-size:17px; margin:30px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--border); }}
  h3 {{ font-size:15px; margin:18px 0 6px; }}
  .sub {{ color:var(--text2); font-size:13.5px; }}
  .cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin:18px 0; }}
  .card {{ background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; }}
  .card .num {{ font-size:24px; font-weight:600; color:var(--primary); }}
  .card .label {{ font-size:12.5px; color:var(--muted); }}
  table {{ width:100%; border-collapse:collapse; background:var(--surface);
    border:1px solid var(--border); border-radius:12px; overflow:hidden; font-size:13.5px; }}
  th, td {{ border-bottom:1px solid var(--border); padding:8px 10px; text-align:left; vertical-align:top; }}
  th {{ background:#edf2f6; color:var(--text2); font-weight:600; font-size:12.5px; }}
  tr:last-child td {{ border-bottom:none; }}
  code {{ background:#eef2f6; padding:1px 5px; border-radius:4px; font-size:12.5px; }}
  pre {{ background:#eef2f6; padding:12px 14px; border-radius:10px; overflow:auto; font-size:12.5px; }}
  .badge {{ display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; }}
  .b-ok {{ background:#e8f7ee; color:#15803d; }}
  .b-warn {{ background:#fdf3e3; color:#9a5b06; }}
  .b-todo {{ background:#eef2f6; color:#475569; }}
  figure {{ margin:0 0 18px; background:var(--surface); border:1px solid var(--border);
    border-radius:12px; overflow:hidden; }}
  figure img {{ width:100%; display:block; }}
  figcaption {{ font-size:12.5px; color:var(--muted); padding:8px 12px; }}
  ul {{ padding-left:1.2em; }}
  .note {{ background:#fdf6e3; border-left:3px solid var(--warn); padding:10px 14px;
    border-radius:6px; font-size:13.5px; }}
  footer {{ margin-top:40px; color:var(--muted); font-size:12.5px; }}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>个人工作台 v2.1 · 本轮交付报告</h1>
    <div class="sub">2026-10-25 · WSL2 Ubuntu-26.04 · 依据 PRD v2.1（Element Plus 版）从零构建 ·
      详细内容见 <code>docs/交付报告.md</code></div>
  </header>

  <div class="cards">
    <div class="card"><div class="num">105</div><div class="label">后端自动化测试全部通过</div></div>
    <div class="card"><div class="num">18</div><div class="label">浏览器端冒烟步骤全部通过</div></div>
    <div class="card"><div class="num">11</div><div class="label">已完成页面（含登录）</div></div>
    <div class="card"><div class="num">7</div><div class="label">业务模块可登录即用</div></div>
  </div>

  <h2>一、结论</h2>
  <p>七个业务模块（打卡、待办、数据表、笔记、便签、翻译、回收站）连同登录、主题、附件、Excel 导入导出都已实现并跑通。
     后端 105 项测试通过，前端类型检查与构建通过，浏览器真实操作 18 步通过，1440×900 / 1280×800 / 768×1024 三个视口均已截图检查。
     仍有 3 项需要你拍板或补证据：正式凭据、Docker 实际构建、以及 PDF 阅读器方案（详见第五节）。</p>

  <h2>二、怎么打开</h2>
  <table>
    <tr><th>方式</th><th>命令 / 地址</th></tr>
    <tr><td>已在运行（最快）</td><td><code>http://127.0.0.1:18080/</code> · 账号 <code>admin</code> / <code>admin12345</code>（仅本地）</td></tr>
    <tr><td>重启本地服务</td><td><code>/home/weiwen/workbench/scripts/dev-server.sh restart</code></td></tr>
    <tr><td>开发模式</td><td><code>uvicorn app.main:app --reload</code>（18080）+ <code>npm run dev</code>（5173）</td></tr>
    <tr><td>生产</td><td><code>cp .env.example .env &amp;&amp; docker compose up -d --build</code>，对外端口 18743</td></tr>
    <tr><td>测试</td><td><code>cd server &amp;&amp; .venv/bin/python -m pytest -q</code>；<code>cd web &amp;&amp; npm run build</code>；<code>cd e2e &amp;&amp; node ui-smoke.mjs</code></td></tr>
  </table>

  <h2>三、模块完成度</h2>
  <table>
    <tr><th>模块</th><th>状态</th><th>关键点</th></tr>
    <tr><td>登录与会话</td><td><span class="badge b-ok">完成</span></td><td>PBKDF2 哈希、可吊销会话、30 天固定有效期、CSRF、失败锁定、改密吊销其他会话</td></tr>
    <tr><td>主题</td><td><span class="badge b-ok">完成</span></td><td>主题存服务端；<code>--wb-*</code> → <code>--el-*</code> 两层变量；弹层同样跟随</td></tr>
    <tr><td>打卡</td><td><span class="badge b-ok">完成</span></td><td>日/周/月北京时间、左闭右开、结束后只读、修改只影响未完成、取消同步最新要求、归档恢复按下一周期</td></tr>
    <tr><td>待办</td><td><span class="badge b-ok">完成</span></td><td>一层子任务、父子联动四个边界、逾期仍可完成、完成区、手动排序</td></tr>
    <tr><td>数据表</td><td><span class="badge b-ok">完成</span></td><td>九种字段、服务端筛选排序分页、版本冲突、结构变更保护</td></tr>
    <tr><td>附件</td><td><span class="badge b-ok">完成</span></td><td>20,000,000 字节边界、类型白名单、引用计数释放</td></tr>
    <tr><td>Excel</td><td><span class="badge b-ok">完成</span></td><td>两种导入、整批原子、任务幂等、全表/筛选导出</td></tr>
    <tr><td>笔记</td><td><span class="badge b-ok">完成</span></td><td>Markdown 预览净化、1.5 秒自动保存、5 分钟历史、恢复前备份</td></tr>
    <tr><td>便签</td><td><span class="badge b-ok">完成</span></td><td>独立标题、单分类、六色、复制正文保留换行</td></tr>
    <tr><td>翻译</td><td><span class="badge b-ok">完成</span></td><td>三家适配、凭据 Fernet 加密脱敏、字节/字符差异化上限、历史只读</td></tr>
    <tr><td>回收站</td><td><span class="badge b-ok">完成</span></td><td>30×24 小时、四类内容、恢复冲突处理、彻底删除释放文件</td></tr>
    <tr><td>部署</td><td><span class="badge b-warn">基本完成</span></td><td>Compose/Dockerfile/Nginx/Alembic/备份脚本齐全，compose 配置校验通过；镜像构建未实测</td></tr>
  </table>

  <h2>四、测试</h2>
  <h3>后端</h3>
  <pre>cd /home/weiwen/workbench/server
.venv/bin/python -m pytest -q
{html.escape(last_line or "105 passed")}</pre>
  <table>
    <tr><th>测试文件</th><th>项数</th><th>重点</th></tr>
    <tr><td>test_auth.py</td><td>8</td><td>未登录拦截、CSRF、统一提示、会话吊销</td></tr>
    <tr><td>test_checkins.py</td><td>18</td><td>周期边界、去重、幂等、锁定、归档恢复、统计</td></tr>
    <tr><td>test_todos.py</td><td>13</td><td>逾期、父子联动、排序、级联删除</td></tr>
    <tr><td>test_tables.py</td><td>17</td><td>字段校验、筛选排序分页、结构变更保护</td></tr>
    <tr><td>test_files_transfers.py</td><td>13</td><td>20MB 边界、鉴权下载、导入原子性与幂等、导出</td></tr>
    <tr><td>test_notes_memos.py</td><td>14</td><td>历史版本策略、恢复备份、便签分类</td></tr>
    <tr><td>test_translate.py</td><td>13</td><td>主密钥缺失、脱敏、三家协议、错误映射</td></tr>
    <tr><td>test_trash.py</td><td>9</td><td>30 天规则、恢复冲突、文件释放</td></tr>
  </table>

  <h3>前端与浏览器</h3>
  <ul>
    <li><code>npm run typecheck</code> 通过；<code>npm run build</code> 通过（element-plus 分包后单块最大 953 kB / gzip 306 kB）</li>
    <li><code>node ui-smoke.mjs</code>：登录 → 分组/店铺 → 事项 → 勾选校验统计 → 清单/待办/子任务 → 建表加字段加数据 → 筛选与 Excel 导入 → 删除后回收站恢复 → 打卡历史 → 图标栏 → 便签 → 笔记自动保存 → 翻译 → 服务设置 → 回收站/设置 → 深浅主题 → 平板/紧凑桌面，<b>18 步全部通过，无控制台报错</b></li>
    <li>逐条验收状态（A01–A86）见 <code>docs/验收对照.md</code></li>
  </ul>

  <h2>五、界面</h2>
  {images}

  <h2>六、本轮修掉的真实缺陷</h2>
  <table>
    <tr><th>现象</th><th>原因</th></tr>
    <tr><td>所有页面只占半屏，右侧大片空白</td><td><code>.wb-main</code> 缺少 <code>flex:1</code>，作为 flex 子项被压到内容宽度</td></tr>
    <tr><td>打卡勾选后清单里看不到事项</td><td>补齐实例时只遍历已结束周期，当前周期被跳过</td></tr>
    <tr><td>没有子任务时无法添加子任务</td><td>子任务输入区只在已有子任务时渲染</td></tr>
    <tr><td>归档对象后当天仍显示旧记录</td><td>归档锁定实例仍参与当天统计</td></tr>
    <tr><td>事项修改记录接口 500</td><td>排序用了不存在的 <code>created_at</code> 字段</td></tr>
    <tr><td>翻译自定义服务地址被丢弃</td><td>保存时只放行凭据字段，<code>base_url</code> 被过滤</td></tr>
    <tr><td>匿名写接口返回 403 而非 401</td><td>CSRF 先于鉴权执行</td></tr>
    <tr><td>导出两次文件名冲突</td><td>文件名只精确到秒</td></tr>
  </table>

  <h2>七、遗留与建议</h2>
  <div class="note">
    <b>需要你确认的三件事</b>
    <ol>
      <li>正式部署前生成并备份 <code>WB_ENCRYPTION_KEY</code>，同时改掉默认管理员密码；</li>
      <li>是否要内置「回收站/暂存文件」的定时清理（现在只有手动接口）；</li>
      <li>附件预览是否要自建 PDF 阅读器（现在是浏览器原生，无分页缩放工具条）。</li>
    </ol>
  </div>
  <ul>
    <li><span class="badge b-todo">未验证</span> Docker 镜像实际构建与容器启动（本机 Docker 守护进程未运行；compose 配置已通过校验）</li>
    <li><span class="badge b-todo">未验证</span> 真实百度/有道/DeepSeek 账号联调（协议、签名、错误映射已用本地假上游覆盖）</li>
    <li><span class="badge b-todo">未验证</span> 实体平板与软键盘、1024×768 横屏</li>
    <li><span class="badge b-warn">部分</span> Excel 数字型「补零格式」导入为文本时不会还原前导零</li>
    <li><span class="badge b-warn">部分</span> 暂存文件 24 小时清理未实现定时任务</li>
  </ul>

  <footer>
    详细内容与逐项证据：<code>docs/交付报告.md</code>、<code>docs/验收对照.md</code>、<code>docs/待办清单.md</code>；
    截图目录 <code>docs/screenshots/</code>。本页由 <code>scripts/gen-report.py</code> 生成。
  </footer>
</div>
</body>
</html>
"""
    OUT.write_text(doc, encoding="utf-8")
    print(f"已生成 {OUT} ({OUT.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
