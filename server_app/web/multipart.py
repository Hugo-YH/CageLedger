import re


def parse_multipart_upload(content_type, raw):
    if "multipart/form-data" not in content_type:
        raise ValueError("请使用 multipart/form-data 上传文件")
    boundary = _multipart_boundary(content_type)
    delimiter = b"--" + boundary
    for part in raw.split(delimiter):
        part = part.strip(b"\r\n")
        if not part or part == b"--" or b"\r\n\r\n" not in part:
            continue
        header_blob, body = part.split(b"\r\n\r\n", 1)
        headers = header_blob.decode("utf-8", errors="replace")
        disposition = next(
            (line for line in headers.split("\r\n") if line.lower().startswith("content-disposition:")), ""
        )
        if 'name="file"' not in disposition:
            continue
        return _multipart_filename(disposition), body.rstrip(b"\r\n")
    raise ValueError("没有找到上传字段 file")


def _multipart_boundary(content_type):
    for segment in content_type.split(";"):
        segment = segment.strip()
        if segment.startswith("boundary="):
            value = segment.split("=", 1)[1].strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            return value.encode("utf-8")
    raise ValueError("上传请求缺少 multipart boundary")


def _multipart_filename(disposition):
    match = re.search(r'filename="([^"]*)"', disposition)
    return match.group(1) if match else ""
