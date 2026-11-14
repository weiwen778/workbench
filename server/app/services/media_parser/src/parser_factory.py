import importlib
import threading
from typing import Dict, Iterable, Type
from .parsers.base_parser import BaseParser

# 工作台默认只启用这三个平台的解析器；其余 parser 文件保留在仓库中，
# 需要时可通过 load_modules 显式载入。
DEFAULT_PARSER_MODULES = (
    "douyin_parser",
    "xiaohongshu_parser",
    "kuaishou_parser",
)


class ParserFactory:
    platform_to_parser: Dict[str, Type[BaseParser]] = {}
    _discovered = False
    _lock = threading.Lock()

    @classmethod
    def register(cls, platform: str, parser_class: Type[BaseParser]):
        """显式注册一个 Parser 类。"""
        cls.platform_to_parser[platform] = parser_class

    @classmethod
    def load_modules(cls, module_names: Iterable[str]) -> None:
        """按需载入指定解析器模块（模块内的装饰器会完成注册）。"""
        for module_name in module_names:
            importlib.import_module(f".parsers.{module_name}", package=__package__)

    @classmethod
    def _discover(cls):
        """载入默认解析器模块（线程安全）。"""
        if cls._discovered:
            return
        with cls._lock:
            if cls._discovered:
                return
            cls.load_modules(DEFAULT_PARSER_MODULES)
            cls._discovered = True

    @classmethod
    def get_parser_class(cls, platform: str):
        cls._discover()
        return cls.platform_to_parser.get(platform)

    @classmethod
    def create_parser(cls, platform: str, real_url: str):
        cls._discover()
        parser_class = cls.platform_to_parser.get(platform)
        if parser_class is None:
            raise ValueError(f"不支持的平台：{platform}")
        return parser_class(real_url)


def register_parser(*platform_names: str):
    """用于装饰器注册 Parser 的方法。

    示例:
        @register_parser("抖音")
        class DouyinParser(BaseParser):
            ...
    """
    def decorator(cls):
        for name in platform_names:
            ParserFactory.register(name, cls)
        return cls
    return decorator


# 确保在需要时通过 get_parser_class/create_parser 懒加载发现解析器

