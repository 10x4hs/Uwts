# Uwts Lyrics

YouTube 노래 영상 옆에, 노래를 따라 차오르는 싱크 가사를 띄워 주는 Chrome 확장 프로그램이에요.

[![Release](https://img.shields.io/github/v/release/10x4hs/Uwts?style=for-the-badge&label=release&labelColor=111111&color=3b82f6)](https://github.com/10x4hs/Uwts/releases/latest)
[![License](https://img.shields.io/github/license/10x4hs/Uwts?style=for-the-badge&labelColor=111111&color=6ab04c)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/10x4hs/Uwts/total?style=for-the-badge&label=downloads&labelColor=111111&color=4cc84a)](https://github.com/10x4hs/Uwts/releases)
![Chrome MV3](https://img.shields.io/badge/chrome-MV3-111111?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=111111&color=f59e0b)

영상만 틀면 Uwts가 곡을 알아내서 LRCLIB, NetEase 같은 가사 서비스에서 싱크 가사를 찾아와요. 가사는 YouTube Music처럼 한 줄씩 떠오르고, 부르는 만큼 글자가 차올라요. 플레이리스트 영상은 곡마다 나눠서 보여 주고, 영상이 음원과 어긋나면 자막과 비교해서 싱크를 알아서 맞춰요.

가사는 그때그때 각 서비스에서 불러와 보여 줄 뿐, 이 저장소나 확장 프로그램에 들어 있지 않아요.

<img width="1666" height="995" alt="Uwts Lyrics 패널" src="https://github.com/user-attachments/assets/4b1df667-d6b6-4dbf-a662-3583ca91e71c" />

## 설치

### **[⬇️ uwts-lyrics.zip 받기 (최신 버전)](https://github.com/10x4hs/Uwts/releases/latest/download/uwts-lyrics.zip)**

```text
1. 위 링크로 zip을 받아 압축을 풀어요
2. uwts-lyrics 폴더를 지우지 않을 곳(예: 문서 폴더)에 옮겨 둬요
3. 주소창에 chrome://extensions        # Edge는 edge://, 웨일은 whale://
4. 오른쪽 위 '개발자 모드'를 켜요
5. '압축해제된 확장 프로그램을 로드합니다' → uwts-lyrics 폴더 선택
```

YouTube에서 노래 영상을 열면 오른쪽에 가사가 나와요. **가사 소스 권한 허용** 버튼이 보이면 한 번 눌러 주세요.

## 업데이트

```text
1. 패널 위 '새 버전 받기'를 눌러 zip을 받아요
2. 원래 uwts-lyrics 폴더에 덮어써요     # 30초 안에 알아서 새 버전으로 바뀌어요
```

바뀐 점은 [Releases](https://github.com/10x4hs/Uwts/releases)에 있어요.

## 할 수 있는 것

| 기능 | 설명 |
|---|---|
| 🎤 **노래방 가사** | 줄이 바뀔 때 부드럽게 넘어가고, 부르는 만큼 글자가 차올라요. 단어 단위 싱크가 있는 곡은 단어마다 따라가요. |
| 📃 **플레이리스트** | 챕터나 고정 댓글의 곡 목록으로 곡을 나눠요. 곡 목록에서 골라 바로 이동하고, 곡이 바뀌면 카드가 떠요. |
| 🎯 **자동 싱크** | YouTube 자막과 비교해 싱크를 맞춰요. 중간에 장면이 끼어든 MV도 구간마다 따로 맞춰요. |
| ⏭️ **노래 없는 구간** | MV의 드라마 인트로나 연기 장면은 [SponsorBlock](https://sponsor.ajay.app) 정보로 건너뛰고 맞춰요. |
| 🪟 **작은 창** | 가사만 따로 띄워서 다른 탭에서도 볼 수 있어요. (Chrome 116 이상) |
| 🔁 **다른 가사** | 가사가 이상하면 버튼 한 번으로 다른 후보로 바꿔요. 고른 가사는 영상마다 기억해요. |
| 💬 **업로더 자막** | 가사 사이트에 없는 노래도 업로더가 단 자막이 있으면 그걸 가사로 보여 줘요. |
| 🖥️ **전체 화면** | 전체 화면에서는 오른쪽에 가사 칸이 붙어요. |

## 개발

```bash
npm install
npm run build        # dist/ 를 압축해제된 확장 프로그램으로 로드
npm test             # vitest
npm run typecheck
```

`dist/`를 로드해 두면 `npm run build`할 때마다 확장 프로그램이 스스로 새 빌드로 바뀌어요.

## 라이선스

[MIT](LICENSE)
