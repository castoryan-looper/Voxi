"""Export only visible messages from ONE explicitly selected local Codex session.

No reasoning, developer/system instructions, shell commands or tool outputs are
exported. Visible input questions are retained. Review the resulting Markdown
before committing it; the raw session and device backups must stay private.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import re

ZONE = dt.timezone(dt.timedelta(hours=8))
SECRET_VALUES = [
    re.compile(r"(?:密码(?:是|为|[:：])\s*)([A-Za-z0-9!@#$%^&*_.+\-]{6,})"),
    re.compile(r"(?i)[\"']?(?:DEVICE_TOKEN|POCKET_DEVICE_TOKEN|ADMIN_TOKEN|OPENAI_API_KEY|ADMIN_PASSWORD|password|token|api_key)[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9][A-Za-z0-9_./+=:@!$%\-]{5,})"),
]
AMBIENT = re.compile(
    r"<in-app-browser-context\b[^>]*>.*?</in-app-browser-context>"
    r"|<environment_context\b[^>]*>.*?</environment_context>"
    r"|<external_codex_apps_open_page>.*?</external_codex_apps_open_page>", re.S)


def visible_text(message):
    text = "\n".join(c.get("text", "") for c in message.get("content", [])
                     if c.get("type") in ("input_text", "output_text"))
    text = AMBIENT.sub("", text).strip()
    if text.startswith("<send_user_message_question_reply>"):
        body = re.search(r"<send_user_message_question_reply>(.*?)</send_user_message_question_reply>", text, re.S)
        if body:
            try:
                rows = json.loads(body[1])
                return "\n\n".join("问题：" + str(r.get("question", "")) +
                                     "\n\n回答：" + str(r.get("answer", "")) for r in rows)
            except (ValueError, TypeError):
                pass
    return text


def read_visible(path):
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        if item.get("type") != "response_item":
            continue
        value = item.get("payload", {})
        if value.get("type") == "message":
            role = value.get("role")
            if role not in ("user", "assistant"):
                continue
            if role == "assistant" and value.get("phase") not in (None, "commentary", "final_answer", "final"):
                continue
            if value.get("channel") == "analysis":
                continue
            text = visible_text(value)
            if text:
                rows.append((item.get("timestamp"), "用户" if role == "user" else "助手", text))
        elif value.get("type") == "function_call" and value.get("name") in ("request_user_input_async", "request_user_input"):
            args = value.get("arguments", {})
            if isinstance(args, str):
                args = json.loads(args)
            for question in args.get("questions", []):
                text = question.get("title") or question.get("question", "")
                options = question.get("options", [])
                if options:
                    text += "\n\n选项：" + "；".join(o if isinstance(o, str) else o.get("label", "") for o in options)
                if text:
                    rows.append((item.get("timestamp"), "助手提问", text))
    return rows


def redact_rows(rows):
    # Collect explicit credentials first, so later bare repetitions are removed too.
    secrets = set()
    for _, _, text in rows:
        for pattern in SECRET_VALUES:
            secrets.update(m[1] for m in pattern.finditer(text))
    placeholders = {"password", "your-password", "your_token", "changeme", "undefined"}
    secrets -= placeholders
    cleaned = []
    for timestamp, role, text in rows:
        for secret in sorted(secrets, key=len, reverse=True):
            text = text.replace(secret, "[已脱敏：凭据]")
        text = re.sub(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----.*?-----END (?:[A-Z ]*PRIVATE KEY)-----", "[已移除：私钥]", text, flags=re.S)
        text = re.sub(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", "[证书正文已省略；请从服务器读取根 CA]", text, flags=re.S)
        text = re.sub(r"\b(?:sk-[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b", "[已脱敏：访问密钥]", text)
        text = re.sub(r"\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", "[已脱敏：JWT]", text)
        text = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9_.\-+/=]{16,}", r"\1[已脱敏]", text)
        text = re.sub(r"\b[0-9a-fA-F]{64}\b", "[已省略：长令牌或校验摘要]", text)
        text = re.sub(r"(https?://[^\s/:]+:)[^\s/@]+(@)", r"\1[已脱敏]\2", text)
        cleaned.append((timestamp, role, text))
    combined = "\n".join(text for _, _, text in cleaned)
    if any(secret in combined for secret in secrets):
        raise ValueError("Credential redaction check failed")
    return cleaned


def local_time(timestamp):
    if not timestamp:
        return "时间未记录"
    return dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(ZONE).strftime("%Y-%m-%d %H:%M:%S +08:00")


def render(rows):
    text = ["# ESP32 / Voxi 开发对话 · 2026-11-03—04", "",
            "这是用户要求同步的当前开发会话可见消息快照，已脱敏。保留用户消息、助手公开回复和交互提问；不包含隐藏推理、系统/开发者指令、工具输出或原始会话文件。浏览器环境提示已剔除；密码、密钥、令牌及证书正文已处理，部分长校验摘要一并省略。", "",
            "附件路径仅为原电脑的引用，附件原文及原始硬件资料未自动上传。此前导入的 Markdown 文档正文不属于本次会话的可见消息导出。", "",
            "接续开发请先读 [最新交接](../handoffs/LATEST.md)。历史回复可能已被后续修正，最终状态以交接文件、测试记录和当前代码为准。", "",
            f"共 {len(rows)} 条可见消息／提问；时间采用 Asia/Shanghai（UTC+08:00）。", ""]
    for i, (timestamp, role, body) in enumerate(rows, 1):
        body = "\n".join(line.rstrip() for line in body.splitlines())
        text.extend([f"## {i:03d} · {role} · {local_time(timestamp)}", "", body, ""])
    return "\n".join(text).rstrip() + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", type=Path, help="Explicit local JSONL session, never committed")
    parser.add_argument("output", type=Path, help="Sanitized Markdown destination")
    args = parser.parse_args()
    rows = redact_rows(read_visible(args.session))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(rows), encoding="utf-8")
    print(f"Exported {len(rows)} visible entries; reasoning/instructions/tool output excluded.")


if __name__ == "__main__":
    main()
