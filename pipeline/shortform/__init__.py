"""숏폼 자동화 파이프라인."""

# Pexels는 Cloudflare 뒤에 있고 Python-urllib UA를 1010으로 막는다(키가 맞아도 403).
# 스톡 사이트 요청에는 전부 이 UA를 붙인다.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


class GateBlocked(Exception):
    """승인 파일이 없어 단계에서 멈춤. 종료 코드 2."""


class MissingKey(Exception):
    """필요한 API 키가 없음. 종료 코드 3."""


class StepFailed(Exception):
    """단계 실행 실패. 종료 코드 1."""
