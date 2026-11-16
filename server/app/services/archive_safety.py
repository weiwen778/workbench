"""Bounded ZIP inspection for user-supplied Office files.

ZIP central-directory sizes are attacker-controlled.  A crafted workbook can
declare a tiny entry while expanding to gigabytes, so every limit here is
enforced against the number of bytes actually produced by the decompressor.
"""
from __future__ import annotations

import io
import zipfile

from ..errors import ApiError

_CHUNK = 64 * 1024


def ensure_zip_within_limits(
    raw: bytes,
    *,
    max_total: int,
    max_entry: int,
    label: str = "表格文件",
    max_entries: int | None = None,
) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise ApiError("INVALID_WORKBOOK", f"{label}不是有效的 Excel 压缩包", 422) from exc
    total = 0
    try:
        entries = archive.infolist()
        if max_entries is not None and len(entries) > max_entries:
            raise ApiError("WORKBOOK_TOO_LARGE", f"{label}包含的条目过多，请拆分后再导入", 413)
        # Fast path for honest archives. Forged declarations are still caught by
        # the bounded actual-byte loop below.
        if sum(max(0, info.file_size) for info in entries) > max_total:
            raise ApiError("WORKBOOK_TOO_LARGE", f"{label}解压后超过大小限制，请拆分后再导入", 413)
        for info in entries:
            if info.is_dir():
                continue
            if info.flag_bits & 0x1:
                raise ApiError("INVALID_WORKBOOK", f"{label}包含加密条目，无法读取", 422)
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ApiError("INVALID_WORKBOOK", f"{label}使用了不支持的压缩方式", 422)
            if info.file_size > max_entry:
                raise ApiError(
                    "WORKBOOK_TOO_LARGE",
                    f"{label}解压后超过大小限制，请拆分后再导入",
                    413,
                    {"limit": max_total, "actual": info.file_size},
                )
            entry_total = 0
            try:
                with archive.open(info) as handle:
                    # ``ZipExtFile`` truncates output to the declared file size.
                    # Lift that private limit while counting so a forged tiny size
                    # cannot hide a multi-gigabyte decompression from this check.
                    try:
                        handle._left = max_entry + 1
                    except AttributeError:
                        pass
                    while True:
                        chunk = handle.read(_CHUNK)
                        if not chunk:
                            break
                        entry_total += len(chunk)
                        total += len(chunk)
                        if entry_total > max_entry or total > max_total:
                            raise ApiError(
                                "WORKBOOK_TOO_LARGE",
                                f"{label}解压后超过大小限制，请拆分后再导入",
                                413,
                                {"limit": max_total, "actual": total},
                            )
                if entry_total != info.file_size:
                    raise ApiError(
                        "INVALID_WORKBOOK",
                        f"{label}压缩包条目声明大小与实际内容不一致",
                        422,
                    )
            except zipfile.BadZipFile as exc:
                if entry_total >= max_entry or total >= max_total:
                    raise ApiError(
                        "WORKBOOK_TOO_LARGE",
                        f"{label}解压后超过大小限制，请拆分后再导入",
                        413,
                        {"limit": max_total, "actual": total},
                    ) from exc
                raise ApiError("INVALID_WORKBOOK", f"{label}压缩包损坏或声明大小不一致", 422) from exc
            except (RuntimeError, NotImplementedError) as exc:
                raise ApiError("INVALID_WORKBOOK", f"{label}压缩包损坏或使用了不支持的压缩方式", 422) from exc
    finally:
        archive.close()
