# Set Algorithm

YouTube/Instagram 화면의 영상 카드 텍스트를 기준으로 적합/부적합 키워드를 판정해 숨기는 Chrome 확장 프로그램입니다. 현재 버전은 부모가 웹 대시보드에서 정책을 저장하면, 아이 기기의 확장이 원격 정책을 받아와 YouTube 홈/검색/추천 카드에 적용합니다.

## 원격 제어 실행

1. 서버 실행

   ```powershell
   cd C:\Users\user\OneDrive\Desktop\set-algorithm\remote-server
   npm start
   ```

2. 부모 대시보드 접속

   ```text
   http://localhost:3000
   ```

3. 아이 기기 Chrome에서 `set-algorithm` 폴더를 확장 프로그램으로 로드합니다.

4. 확장 팝업의 `원격 제어` 섹션에서 서버 주소를 입력합니다.

   같은 PC 테스트: `http://localhost:3000`

   다른 기기 테스트: 부모 PC의 LAN 주소 예시 `http://192.168.0.12:3000`

5. 확장 팝업에 보이는 `기기 ID`를 부모 대시보드에 입력하고 정책을 저장합니다. 확장은 약 30초마다 정책을 가져오며, `지금 동기화` 버튼으로 즉시 가져올 수도 있습니다.

## 필터 모드

- `부적합 키워드만 숨기기`: exclude 키워드가 포함된 영상만 숨깁니다.
- `적합 키워드만 남기기`: include 키워드가 포함되고 exclude 키워드가 없는 영상만 남깁니다.
- `기존 목적 점수 방식`: 기존 패키지 점수 방식으로 include는 가산, exclude는 감산합니다.

## 개발 확인

```powershell
node tests\classifier.test.js
node --check background.js
node --check content.js
node --check popup.js
node --check keyword-popup.js
node --check remote-server\server.js
```

프로토타입에서는 임의 서버 주소로 정책을 받아올 수 있도록 manifest host permission을 넓게 열어두었습니다. 배포 단계에서는 실제 API 도메인으로 제한하는 편이 좋습니다.
