import json
from pathlib import Path
import tempfile
import unittest
from export_development_chat import read_visible, redact_rows, render


class ExportChatTest(unittest.TestCase):
    def test_visible_messages_and_questions_only(self):
        records = []
        def item(payload):
            records.append({"type": "response_item", "timestamp": "2026-11-03T23:00:00Z", "payload": payload})
        for role in ("system", "developer", "user", "assistant"):
            item({"type": "message", "role": role, "content": [{"type": "output_text", "text": role}]})
        item({"type": "reasoning", "text": "hidden reasoning"})
        item({"type": "message", "role": "assistant", "channel": "analysis", "content": [{"type": "output_text", "text": "hidden analysis"}]})
        item({"type": "function_call_output", "output": "private tool output"})
        item({"type": "function_call", "name": "request_user_input_async", "arguments": json.dumps({"questions": [{"title": "是否正常？", "options": ["正常", "异常"]}]})})
        item({"type": "message", "role": "user", "content": [{"type": "input_text", "text": '<in-app-browser-context>ambient only</in-app-browser-context>'}]})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "session.jsonl"
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
            rows = read_visible(path)
        self.assertEqual(len(rows), 3)
        text = render(rows)
        self.assertIn("2026-11-04 07:00:00 +08:00", text)
        self.assertIn("是否正常？", text)
        for private in ("hidden reasoning", "hidden analysis", "private tool output", "ambient only"):
            self.assertNotIn(private, text)

    def test_credentials_and_bare_repetitions_are_redacted(self):
        secret = "ExampleSecret42"
        text = '用户名alice，密码是' + secret + '\nDEVICE_TOKEN=' + 'ab' * 32
        rows = [(None, "用户", text), (None, "助手", "使用 " + secret + " 登录；版本 8b0704f")]
        result = render(redact_rows(rows))
        self.assertNotIn(secret, result)
        self.assertNotIn('ab' * 32, result)
        self.assertIn("8b0704f", result)

    def test_key_material_and_answer_wrapper(self):
        body = '<send_user_message_question_reply>' + json.dumps([{"question": "状态？", "answer": "正常"}], ensure_ascii=False) + '</send_user_message_question_reply>'
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "session.jsonl"
            path.write_text(json.dumps({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": body}]}}, ensure_ascii=False), encoding="utf-8")
            rows = read_visible(path)
        self.assertIn("回答：正常", rows[0][2])
        private = '-----BEGIN PRIVATE KEY-----\nprivate-body\n-----END PRIVATE KEY-----'
        self.assertNotIn("private-body", redact_rows([(None, "用户", private)])[0][2])


if __name__ == "__main__":
    unittest.main()
