
### 수정: 아카이브 뷰어에서 기획안 md 한글이 깨지는 문제 (4efa5c7, 2026-09-23 07:10)
- Windows 의 Python mimetypes 는 레지스트리를 따라가서 .md·.srt 를 모른다(None → octet-stream). 확장자 매핑을 코드에 직접 둬야 PC마다 결과가 같다.
- 텍스트 Content-Type 에 charset 이 없고 nosniff 까지 붙으면 브라우저가 UTF-8 한글을 깨뜨린다. MD5만 보는 업로드 건너뛰기는 타입이 틀린 기존 객체를 영영 못 고치므로 ContentType 도 비교해야 한다.
