# systemd 등록 가이드

## 1. 목적

라즈베리파이에서 `npm run start`를 터미널에 띄워두지 않고
백그라운드 서비스로 실행하기 위한 가이드입니다.

대상:

- `ourHangout-openclaw-connector` 최초 pairing 등록이 끝난 상태
- `connector-auth-token.txt`가 이미 생성된 상태

## 2. 최초 1회 수동 등록

가장 쉬운 방법은 수동 단계를 직접 하지 않고
repo 루트의 `install-service.sh`를 사용하는 것입니다.

예:

```bash
chmod +x install-service.sh
./install-service.sh 7H2K9P
```

또는 코드 입력 프롬프트 사용:

```bash
chmod +x install-service.sh
./install-service.sh
```

이 스크립트는:

1. `npm install`
2. pairing code 등록
3. `connector-auth-token.txt` 생성 확인
4. systemd service 설치/시작

을 한 번에 처리합니다.

아래 내용은 수동으로 설치할 때의 절차입니다.

먼저 앱에서 포비 연결 코드를 만들고,
라즈베리파이에서 한 번 수동으로 실행합니다.

예:

```bash
cd ~/ourHangout-openclaw-connector
npm run start -- 7H2K9P
```

이후 아래 파일이 생겨야 합니다.

```bash
ls -l ~/ourHangout-openclaw-connector/connector-auth-token.txt
```

이 파일이 생긴 뒤부터는 `PAIRING_CODE` 없이 서비스 실행이 가능합니다.

## 3. 서비스 파일 복사

repo 안의 템플릿:

- `deploy/ourhangout-openclaw-connector.service`

복사:

```bash
sudo cp deploy/ourhangout-openclaw-connector.service /etc/systemd/system/
```

필요하면 아래 두 줄을 실제 환경에 맞게 수정합니다.

- `User=pi`
- `WorkingDirectory=/home/pi/ourHangout-openclaw-connector`

## 4. 등록 / 시작

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ourhangout-openclaw-connector
```

## 5. 상태 확인

```bash
systemctl status ourhangout-openclaw-connector
```

실시간 로그:

```bash
journalctl -u ourhangout-openclaw-connector -f
```

## 6. 재시작 / 중지

재시작:

```bash
sudo systemctl restart ourhangout-openclaw-connector
```

중지:

```bash
sudo systemctl stop ourhangout-openclaw-connector
```

비활성화:

```bash
sudo systemctl disable ourhangout-openclaw-connector
```

## 7. 재-pairing이 필요할 때

아래 경우엔 pairing을 다시 합니다.

- 다른 포비에 연결
- token 파일 삭제
- 서버 쪽에서 connector 폐기

절차:

```bash
sudo systemctl stop ourhangout-openclaw-connector
rm -f ~/ourHangout-openclaw-connector/connector-auth-token.txt
cd ~/ourHangout-openclaw-connector
npm run start -- 새연결코드
sudo systemctl start ourhangout-openclaw-connector
```
