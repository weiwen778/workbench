"""翻译语言目录。

系统内部统一使用同一套语言代码（`code`），各家服务按自己的写法取值：
百度用 `jp`/`kor`/`fra`，有道用 `ja`/`ko`/`fr`，DeepSeek 直接用英文名。
"""

from __future__ import annotations

from ..errors import ApiError

PROVIDERS = ("baidu", "youdao", "deepseek")

LANGUAGES: list[dict[str, str]] = [
    {"code": "zh", "name": "中文（简体）", "baidu": "zh", "youdao": "zh-CHS", "deepseek": "Simplified Chinese"},
    {"code": "en", "name": "英语", "baidu": "en", "youdao": "en", "deepseek": "English"},
    {"code": "ja", "name": "日语", "baidu": "jp", "youdao": "ja", "deepseek": "Japanese"},
    {"code": "ko", "name": "韩语", "baidu": "kor", "youdao": "ko", "deepseek": "Korean"},
    {"code": "fr", "name": "法语", "baidu": "fra", "youdao": "fr", "deepseek": "French"},
    {"code": "es", "name": "西班牙语", "baidu": "spa", "youdao": "es", "deepseek": "Spanish"},
    {"code": "de", "name": "德语", "baidu": "de", "youdao": "de", "deepseek": "German"},
    {"code": "ru", "name": "俄语", "baidu": "ru", "youdao": "ru", "deepseek": "Russian"},
    {"code": "pt", "name": "葡萄牙语", "baidu": "pt", "youdao": "pt", "deepseek": "Portuguese"},
    {"code": "it", "name": "意大利语", "baidu": "it", "youdao": "it", "deepseek": "Italian"},
    {"code": "ar", "name": "阿拉伯语", "baidu": "ara", "youdao": "ar", "deepseek": "Arabic"},
    {"code": "th", "name": "泰语", "baidu": "th", "youdao": "th", "deepseek": "Thai"},
    {"code": "vi", "name": "越南语", "baidu": "vie", "youdao": "vi", "deepseek": "Vietnamese"},
    {"code": "zh-Hant", "name": "中文（繁体）", "baidu": "cht", "youdao": "zh-CHT", "deepseek": "Traditional Chinese"},
    {"code": "nl", "name": "荷兰语", "baidu": "nl", "youdao": "nl", "deepseek": "Dutch"},
    {"code": "pl", "name": "波兰语", "baidu": "pl", "youdao": "pl", "deepseek": "Polish"},
    {"code": "el", "name": "希腊语", "baidu": "el", "youdao": "el", "deepseek": "Greek"},
]

_BY_CODE = {item["code"]: item for item in LANGUAGES}


def language_catalog() -> list[dict[str, str]]:
    """全站语言列表（不含各家代码），用于界面显示和历史记录回显。"""
    return [{"code": item["code"], "name": item["name"]} for item in LANGUAGES]


def languages_for(provider: str) -> list[dict[str, str]]:
    """某个翻译服务实际支持的语言。"""
    return [
        {"code": item["code"], "name": item["name"]}
        for item in LANGUAGES
        if item.get(provider)
    ]


def supports(provider: str, code: str) -> bool:
    entry = _BY_CODE.get(code)
    return bool(entry and entry.get(provider))


def to_provider_code(provider: str, code: str) -> str:
    """把内部语言代码换成该服务要求的写法；auto 按各家约定处理。"""
    if code == "auto":
        return {"baidu": "auto", "youdao": "auto", "deepseek": ""}.get(provider, "auto")
    entry = _BY_CODE.get(code)
    if not entry or not entry.get(provider):
        raise ApiError("UNSUPPORTED_LANGUAGE", "这个翻译服务不支持所选语言", 422)
    return entry[provider]
