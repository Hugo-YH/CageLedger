import re
from email import policy
from email.errors import UndecodableBytesDefect
from email.parser import BytesHeaderParser

_LINE_END = re.compile(rb"\r\n|\r|\n")
_BOUNDARY_END = re.compile(rb"(?P<closing>--)?[ \t]*(?:\r\n|\r|\n|\Z)")
_INVALID_HEADER_BYTES = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MAX_PART_HEADER_BYTES = 64 * 1024
_ENCODED_FILENAME_DEFECTS = frozenset(
    ("encoded word inside quoted string", "missing trailing whitespace after encoded-word")
)


def parse_multipart_upload(content_type, raw):
    return parse_multipart_files(content_type, raw, max_files=1)[0]


def parse_multipart_files(content_type, raw, *, max_files):
    if content_type.split(";", 1)[0].strip().lower() != "multipart/form-data":
        raise ValueError("请使用 multipart/form-data 上传文件")
    boundaries = _multipart_boundaries(raw, _multipart_boundary(content_type))
    delimiter = next(boundaries, None)
    if delimiter is None or delimiter[2]:
        raise ValueError("上传请求 multipart 格式不完整")
    files = []
    for following in boundaries:
        headers, body_start = _multipart_headers(raw, delimiter[1], following[0])
        part_end = following[0]
        # Exactly one newline belongs to the delimiter, not the file payload.
        if raw[part_end - 2 : part_end] == b"\r\n":
            part_end -= 2
        elif part_end and raw[part_end - 1] in (10, 13):
            part_end -= 1
        part_end = max(body_start, part_end)
        if (
            headers.get_content_disposition() == "form-data"
            and headers.get_param("name", header="content-disposition") == "file"
        ):
            files.append((headers, body_start, part_end))
        if following[2]:
            break
        delimiter = following
    else:
        raise ValueError("上传请求 multipart 格式不完整")
    if len(files) > max_files:
        raise ValueError(
            "每次请求只能上传一个 file 文件" if max_files == 1 else f"每次最多上传 {max_files} 个 file 文件"
        )
    result = []
    for headers, body_start, body_end in files:
        if headers.get_content_maintype() in ("multipart", "message") or "Content-Transfer-Encoding" in headers:
            raise ValueError("上传文件必须使用原始二进制内容")
        result.append((headers.get_filename() or "", raw[body_start:body_end]))
    if not result:
        raise ValueError("没有找到上传字段 file")
    return result


def _multipart_boundaries(raw, boundary):
    marker = b"--" + boundary
    position = 0
    while (position := raw.find(marker, position)) >= 0:
        marker_end = position + len(marker)
        if position == 0 or raw[position - 1] in (10, 13):
            suffix = _BOUNDARY_END.match(raw, marker_end)
            if suffix:
                yield position, suffix.end(), bool(suffix["closing"])
                position = suffix.end()
                continue
        position = marker_end


def _multipart_headers(raw, start, end):
    # Never pass the binary body through email's text/MIME payload parser.
    limit = min(end, start + _MAX_PART_HEADER_BYTES + 1)
    position = start
    body_start = None
    while position < limit:
        newline = _LINE_END.search(raw, position, limit)
        if newline is None:
            break
        if newline.start() == position:
            body_start = newline.end()
            end = position
            break
        position = newline.end()
    if body_start is None or end - start > _MAX_PART_HEADER_BYTES or _INVALID_HEADER_BYTES.search(raw, start, end):
        raise ValueError("上传请求 multipart 格式不完整")
    headers = BytesHeaderParser(policy=policy.default).parsebytes(raw[start:end])
    names = [name.lower() for name in headers.keys()]
    if (
        headers.defects
        or len(names) != len(set(names))
        or any(
            not isinstance(defect, UndecodableBytesDefect)
            # Preserve email's existing raw UTF-8 and RFC 2047 filename support.
            and not (name.lower() == "content-disposition" and str(defect) in _ENCODED_FILENAME_DEFECTS)
            for name, value in headers.items()
            for defect in value.defects
        )
    ):
        raise ValueError("上传请求 multipart 格式不完整")
    return headers, body_start


def _multipart_boundary(content_type):
    if "\r" in content_type or "\n" in content_type or not content_type.isascii():
        raise ValueError("上传请求 Content-Type 无效")
    boundary = None
    for segment in content_type.split(";"):
        segment = segment.strip()
        if segment.lower().startswith("boundary="):
            value = segment.split("=", 1)[1].strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            if not re.fullmatch(r"[0-9A-Za-z'()+_,./:=? -]{1,70}", value) or value.endswith(" "):
                raise ValueError("上传请求 multipart boundary 无效")
            if boundary is not None:
                raise ValueError("上传请求 multipart boundary 无效")
            boundary = value.encode("ascii")
    if boundary is not None:
        return boundary
    raise ValueError("上传请求缺少 multipart boundary")
