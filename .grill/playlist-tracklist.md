# Grill: 플레이리스트 곡 목록에서 골라 이동하기
Date: 2026-11-05

## Intent
여러 가수의 곡이 이어지는 플레이리스트 영상에서, 패널 안에서 곡 목록을 보고 원하는 곡으로 바로 넘어가고 싶다.

## Key decisions
- Decision: 목적은 "바로 이동"과 "둘러보기" 둘 다지만 실제 사용은 이동 위주. Reason: 사용자 답변. Alternative considered: 가사 위에 늘 떠 있는 접이식 목록 (패널이 좁아 기각).
- Decision: 곡을 누르면 영상이 그 곡 시작으로 이동하고 목록은 자동으로 닫힌다. Reason: 이동 위주 사용. Alternative considered: 목록을 열어 둔 채 유지.
- Decision: 헤더 목록 버튼 + "N / M곡" 글자 둘 다로 연다. Reason: 찾기 쉬움 + 자연스러운 동작.
- Decision: 목록에는 번호·제목·가수·시작 시간만. Reason: 가사 유무를 미리 찾으면 느리고 서버 요청이 많음. Alternative considered: 가사 없는 곡 흐리게.

## Out of scope
- 번역 기능 (품질이 낮아 제거함).
- 곡별 가사 유무 미리 확인.
