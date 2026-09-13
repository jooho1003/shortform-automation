import hashlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from shortform import MissingKey, StepFailed
from shortform import buffer_api as api


ITEM = {
    'platform': 'youtube', 'channel_id': 'a' * 24, 'title': '테스트 제목',
    'text': '테스트 설명', 'video_url': 'https://media.example.org/video.mp4',
    'mode': 'schedule', 'due_at': '2099-01-01T10:00:00+09:00',
    'privacy': 'unlisted', 'episode': '2026-09-12/B-02-테스트',
}


def response(body):
    result = MagicMock()
    result.__enter__.return_value = result
    result.status = 200
    result.read.side_effect = io.BytesIO(body).read
    return result


class BufferApiTests(unittest.TestCase):
    def client(self):
        with patch.dict('os.environ', {'BUFFER_API_KEY': 'secret-test-key'}):
            client = api.BufferClient()
        client._opener = MagicMock()
        return client

    def test_missing_credentials_does_not_launch_login_or_send(self):
        with tempfile.TemporaryDirectory() as d, patch.dict('os.environ', {}, clear=True), \
                patch.object(api, 'KEY_FILE', Path(d) / 'absent.txt'):
            with self.assertRaises(MissingKey):
                api.BufferClient()

    def test_schedule_and_privacy_are_explicit(self):
        value = api.BufferClient.post_input(ITEM)
        self.assertEqual(value['mode'], 'customScheduled')
        self.assertEqual(value['dueAt'], ITEM['due_at'])
        self.assertEqual(value['metadata']['youtube']['privacy'], 'unlisted')
        self.assertFalse(value['metadata']['youtube']['isAiGenerated'])
        with self.assertRaises(StepFailed):
            api.BufferClient.post_input({**ITEM, 'mode': 'pending'})

    def test_draft_does_not_schedule(self):
        value = api.BufferClient.post_input({**ITEM, 'mode': 'draft'})
        self.assertTrue(value['saveToDraft'])
        self.assertNotIn('dueAt', value)

    def test_instagram_reel_and_a_track_disclosure(self):
        value = api.BufferClient.post_input({**ITEM, 'platform': 'instagram', 'episode': '2026-09-12/A-01-개'})
        self.assertEqual(value['metadata']['instagram'], {
            'type': 'reel', 'shouldShareToFeed': True, 'isAiGenerated': True,
        })

    def test_request_auth_only_goes_to_fixed_api_endpoint(self):
        client = self.client()
        client._opener.open.return_value = response(json.dumps({'data': {'account': {}}}).encode())
        client._request('query { account { organizations { id } } }')
        req = client._opener.open.call_args.args[0]
        self.assertEqual(req.full_url, 'https://api.buffer.com')
        self.assertEqual(req.get_header('Authorization'), 'Bearer secret-test-key')

    def test_error_body_and_secrets_are_not_exposed_or_retried(self):
        client = self.client()
        client._opener.open.side_effect = urllib.error.HTTPError(
            'https://api.buffer.com?secret=secret-test-key', 401, 'secret-test-key', {}, io.BytesIO(b'secret-test-key'))
        with self.assertRaises(StepFailed) as caught:
            client._request('query {}')
        self.assertNotIn('secret-test-key', str(caught.exception))
        self.assertIn('401', str(caught.exception))
        self.assertEqual(client._opener.open.call_count, 1)

    def test_remote_media_requires_exact_hash_without_auth(self):
        payload = b'reviewed-video-bytes'
        client = self.client()
        with tempfile.TemporaryDirectory() as d, patch.object(api, 'ROOT', Path(d)), \
                patch.object(api.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]):
            (Path(d) / 'video.mp4').write_bytes(payload)
            item = {**ITEM, 'file': 'video.mp4', 'sha256': hashlib.sha256(payload).hexdigest()}
            client._opener.open.return_value = response(payload)
            client.verify_media(item)
            req = client._opener.open.call_args.args[0]
            self.assertIsNone(req.get_header('Authorization'))
            client._opener.open.return_value = response(b'wrong-video')
            with self.assertRaises(StepFailed):
                client.verify_media(item)

    def test_private_dns_target_never_requested(self):
        client = self.client()
        with patch.object(api.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(StepFailed):
                client.verify_media(ITEM)
        client._opener.open.assert_not_called()

    def test_rejected_or_incomplete_mutation_is_not_success(self):
        client = self.client()
        for result in [{'__typename': 'PostInvalidInputError', 'message': 'sensitive'},
                       {'__typename': 'PostActionSuccess', 'post': {'id': 'abc'}}]:
            client._opener.open.return_value = response(json.dumps({'data': {'createPost': result}}).encode())
            with self.assertRaises(StepFailed):
                client.create_post(ITEM)


if __name__ == '__main__':
    unittest.main()
