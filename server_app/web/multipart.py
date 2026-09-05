import re
from email import policy
from email.parser import BytesParser


def parse_multipart_upload(content_type, raw):
    if content_type.split(";", 1)[0].strip().lower() != "multipart/form-data":
        raise ValueError("请使用 multipart/form-data 上传文件")
    _multipart_boundary(content_type)
    message = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + raw
    )
    if not message.is_multipart() or any(part.defects for part in message.walk()):
        raise ValueError("上传请求 multipart 格式不完整")
    files = [
        part
        for part in message.iter_parts()
        if part.get_content_disposition() == "form-data"
        and part.get_param("name", header="content-disposition") == "file"
    ]
    if len(files) > 1:
        raise ValueError("每次请求只能上传一个 file 文件")
    if files:
        part = files[0]
        if part.is_multipart() or part.get("Content-Transfer-Encoding"):
            raise ValueError("上传文件必须使用原始二进制内容")
        return part.get_filename() or "", part.get_payload(decode=True)
    raise ValueError("没有找到上传字段 file")


def _multipart_boundary(content_type):
    if "\r" in content_type or "\n" in content_type or not content_type.isascii():
        raise ValueError("上传请求 Content-Type 无效")
    for segment in content_type.split(";"):
        segment = segment.strip()
        if segment.lower().startswith("boundary="):
            value = segment.split("=", 1)[1].strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            if not re.fullmatch(r"[0-9A-Za-z'()+_,./:=? -]{1,70}", value) or value.endswith(" "):
                raise ValueError("上传请求 multipart boundary 无效")
            return value.encode("ascii")
    raise ValueError("上传请求缺少 multipart boundary")
