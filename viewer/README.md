# 작업 아카이브 뷰어

로컬에서 만든 편 영상·상세페이지·이미지·릴스기획 자료를 원격에서 보는 페이지다.

- 파일은 Cloudflare R2에 있고, 버킷은 **공개하지 않는다**.
- `functions/r2/[[path]].js` 가 R2 바인딩으로 직접 읽어 내려 준다(Range 지원 → 영상 탐색 가능).
- 인증은 **Cloudflare Access** 가 앞단에서 맡는다. 코드에는 인증 로직이 없다.

## 올리기

로컬에서:

    cd pipeline
    .venv/Scripts/python -m shortform archive publish

바뀐 파일만 올라가고 `archive/index.json` 이 갱신된다. 뷰어는 그 목록만 읽는다.

## 배포

`wrangler.toml` 의 `bucket_name` 을 실제 버킷 이름으로 바꾼 뒤 Cloudflare Pages에 연결한다.
자세한 순서는 `docs/40-원격-아카이브-뷰어.md` 참고.
