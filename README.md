# Set Algorithm

부모가 웹 대시보드에서 자녀 기기의 YouTube 필터 정책을 바꾸면, 자녀 쪽 Chrome 확장 프로그램이 주기적으로 정책을 가져와 영상 카드를 숨기는 프로젝트입니다.

## 실행

1. 부모 원격 서버 실행

   ```powershell
   node server.js
   ```

2. 부모 대시보드 접속

   ```text
   http://localhost:3000/parent
   ```

3. 자녀 기기 Chrome에서 이 폴더를 압축 해제 확장 프로그램으로 로드합니다.

4. 확장 팝업의 `원격 제어` 영역에서 서버 주소를 저장합니다.

   같은 PC 테스트:

   ```text
   http://localhost:3000
   ```

   다른 기기 테스트:

   ```text
   http://부모PC의-LAN-IP:3000
   ```

5. 확장 팝업에 표시되는 `기기 ID`를 부모 대시보드에 입력하고 정책을 저장합니다.

확장은 설치 후에도 30초마다 부모 서버 정책을 가져옵니다. 즉시 반영하려면 확장 팝업에서 `지금 동기화`를 누르면 됩니다.

## 필터 모드

- `차단 키워드만 숨기기`: 차단 키워드가 들어간 영상만 숨깁니다.
- `허용 키워드가 있는 영상만 보이기`: 허용 키워드가 들어가고 차단 키워드가 없는 영상만 보입니다.
- `패키지 목적 점수로 판단`: 패키지의 허용 키워드는 가산, 차단 키워드는 감산해서 목적에 맞는 영상만 남깁니다.

## 개발 확인

```powershell
node tests\classifier.test.js
node --check server.js
node --check background.js
node --check content.js
node --check popup.js
node --check keyword-popup.js
node --check remote-server\server.js
node --check remote-server\public\app.js
```

## Render deployment

`render.yaml` is included for a Render Blueprint deployment. It starts the Node server
and mounts a persistent disk at `/var/data`, so device policies survive restarts and
new deployments.

1. Push this project to a private GitHub repository.
2. In Render, create a new Blueprint and select the repository.
3. Approve the `starter` web service and 1 GB persistent disk requested by `render.yaml`.
4. After deployment, enter the Render URL, such as `https://set-algorithm-remote.onrender.com`,
   in the child extension's remote server address.

The application is a family-control tool. Before sharing the URL, add authentication
for the parent dashboard and device API, or keep the URL private.

실제 자녀 기기가 다른 네트워크에 있으면 `localhost`는 사용할 수 없습니다. 배포 서버 주소나 같은 네트워크에서 접근 가능한 부모 PC 주소를 확장 팝업에 넣어야 합니다.
