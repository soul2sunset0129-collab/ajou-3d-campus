# 아주대학교 3D 캠퍼스

OpenStreetMap 외곽선, 아주대 공식 캠퍼스맵 자료, 공식 사진, VWorld 위성영상을 합쳐 만든 아주대학교(본교 + 의료캠퍼스) 3D 지도입니다.

## 데이터가 쌓이는 순서 (뒤가 앞을 덮어씀)
1. **OpenStreetMap** — 건물 외곽선, 도로, 녹지 (`data/osm_raw.json`, `data/osm_medical.json`)
2. **아주대 공식 캠퍼스맵** — 지상·지하 층수, 층별 안내, 준공 연도, 공식 이름 (`scripts/fetch_official.py` → `data/official_buildings.json`)
3. **사진·위성영상 판독** — 외벽 색·재질·창 형식, 부분별 높이(탑/기단), 외곽선 보정 (`data/visual_analysis.json`), 직접 그린 OSM 밖 건물·교문·선구자상 배치 (`data/campus_manual.json`)
4. **정밀 조사 에이전트 결과** (`scripts/merge_research.py` → `data/buildings_research.json`)
5. **사용자 제보** (`data/user_overrides.json`) — 예: 율곡관 앞 5층·뒤 3층

지붕 색은 위성영상에서 직접 잰 값입니다 (`scripts/analyze_imagery.py` → `data/roof_colors.json`).

## 지형
실제 고도(Copernicus GLO-30 DEM, 약 30 m 간격)로 만든 지형 위에 캠퍼스가 놓여 있습니다(`scripts/build_terrain.py` → `terrain-data.js`).
- 고도 자료는 건물 지붕·나무 꼭대기가 섞인 표면 모델이라, 약 68 m 창의 형태학적 열림으로 건물·나무 돌출을 깎아 맨땅을 추정하고, 넓은 숲은 위성영상의 수관 비율만큼 낮췄습니다.
- 차로는 길게 평활한 종단면으로, 운동장·주차장·선구자상 광장은 평평하게 정지했습니다.
- 건물은 자연 지형에 그대로 앉습니다. 발밑 지형의 중앙값을 바닥으로 두고, 낮은 쪽은 기단이나 지하층 외벽이 드러나고 높은 쪽은 땅에 묻힙니다.
- 도로·보도·녹지·주차칸·운동장 라인은 지면 텍스처(0.6 m/픽셀)로 그려 지형에 입힙니다. 가파른 비탈은 석축 색으로 보입니다.
- 캠퍼스 안 고도차는 약 64 m입니다(병원·체육관 쪽 해발 약 46 m → 산학협력원 언덕 약 110 m). 정보 패널에 건물 지면의 해발 높이가 나옵니다.

다시 만들기:
```
python scripts/process_osm.py
python scripts/build_terrain.py <위성영상 캐시 폴더>   # 폴더는 analyze_imagery.py 와 같은 것(없으면 OSM 숲 기준으로 보정)
```

## 실행
`실행.bat`을 더블클릭하세요. 로컬 서버(http://localhost:8731)를 켜고 브라우저를 엽니다.
JS 모듈을 쓰기 때문에 `index.html`을 파일로 바로 열면 동작하지 않습니다. 인터넷 연결이 필요합니다(Three.js CDN).

```
python scripts/serve.py 8731
```

## 캠퍼스 탐험 모드
사이드바의 **🚶 캠퍼스 탐험 모드** 버튼을 누르면 사람 눈높이(1.65 m)로 캠퍼스를 걸어 다닙니다. 건물을 선택한 상태에서 누르면 그 건물 앞에서 시작합니다.

| 조작 | PC | 모바일 |
|---|---|---|
| 이동 | W A S D / 방향키 | 왼쪽 아래 조이스틱 |
| 둘러보기 | 마우스(잠금이 되는 브라우저) 또는 마우스 드래그 | 화면 드래그 |
| 달리기 | Shift | 조이스틱 끝까지 |
| 건물 정보 | 십자선을 건물에 두고 클릭 | 짧게 탭 |
| 순간이동 | 왼쪽 위 "건물로 이동" | 같음 |
| 일시정지 / 종료 | ESC(마우스 잠금 중) / Q 또는 "탐험 종료" | "탐험 종료" |

건물·나무 줄기·분수대에 부딪히면 멈추고, 실제 지형의 오르막·내리막과 노천극장 계단을 따라 눈높이가 바뀝니다. 미니맵(오른쪽 아래)은 북쪽이 위입니다.
마우스 잠금이 막힌 환경(앱 미리보기 창, iframe 등)에서는 자동으로 드래그 방식으로 바뀌고, 일시정지 창의 "계속 둘러보기"는 잠금 성공 여부와 상관없이 항상 닫힙니다.

## 캠퍼스 폭파 모드
사이드바의 **💥 캠퍼스 폭파 모드**를 누르면, 땅이나 건물을 클릭한 곳에 폭탄이 떨어집니다(드래그는 시점 이동).
- 폭발: 불덩이 · 섬광 · 충격파 고리 · 연기 · 파편 · 화면 흔들림 · 폭발음(브라우저에서 합성, 🔊 버튼으로 끄기), 땅에 폭발 자국, 반경 안의 나무가 쓰러짐
- 부분 파괴: 건물을 층 × 격자 칸으로 나눠, 맞은 자리만 **맨 위층부터 한 층씩** 부서집니다. 같은 자리를 또 맞히면 그 아래층이 부서져요
  - 소형: 1개 층, 맞은 건물 한 층 면적의 약 10%(다산관이면 한 층의 1/10)
  - 대형: 2개 층, 한 층 면적의 약 20%(소형의 두 배)
  - 받칠 곳이 없어진 칸은 떨어지고, 부서진 자리 아래엔 잔해 · 먼지가 남습니다. 건물의 80% 이상이 부서지면 나머지도 무너집니다
- 땅에 떨어지면 가까운 건물 옆면이 부서집니다 · "↺ 복구"로 모두 되돌리기 · 모드를 나가면 자동 복구

## 직접 알고 있는 사실 반영하기
`data/user_overrides.json`에 적은 내용은 자동 조사 결과보다 우선합니다. 예: 율곡관은 "앞부분(남쪽) 5층, 뒷부분 3층".
`base_floors`는 건물 전체를 덮는 층수, `parts`는 그보다 높은 부분의 외곽(로컬 좌표 m, x=동, y=북)과 층수입니다. 고친 뒤 `python scripts/process_osm.py`를 실행하세요.

## 구성
- `index.html`: 화면 UI
- `js/main.js`: 장면·지면·건물·카메라·선택 처리 (Three.js 0.160)
- `js/facades.js`: 사진을 참고한 건물 외벽 텍스처(띠창, 벽돌 저층부, 야간 창문 불빛)
- `js/vegetation.js`: 나무 5종(소나무·벚나무·은행나무·단풍나무·활엽수) 배치와 계절 색
- `js/landmarks.js`: 선구자상(기마상·분수·벽돌 광장·회양목 화단), 노천극장(위성영상 판독 계단식 객석)
- `js/explore.js`: 캠퍼스 탐험 모드(1인칭 이동, 충돌, 미니맵, 모바일 조이스틱)
- `js/demolition.js`: 캠퍼스 폭파 모드(폭탄 투하, 폭발 효과, 붕괴, 복구)
- `js/fracture.js`: 부분 파괴(건물을 층 × 격자 칸으로 나눠 위층부터 부수고 다시 그림)
- `scripts/analyze_imagery.py`: VWorld 위성영상으로 지붕 실측 색(`data/roof_colors.json`)과 건물 판독용 이미지를 만듦
- `js/terrain.js`: 지형 메시, 지면 텍스처(도로·녹지·운동장 라인), 높이 조회
- `scripts/build_terrain.py`: Copernicus DEM → 맨땅 추정 · 정지 → `terrain-data.js`
- `scripts/serve.py`: 캐시를 끈 로컬 서버
- `reference-photos/`: 위키미디어 공용에서 받은 참고 사진과 출처(`credits.json`). `scripts/fetch_photos.py`로 다시 받을 수 있음
- `campus-data.js`: 변환된 캠퍼스 데이터 (자동 생성)
- `scripts/process_osm.py`: 위 데이터를 모두 합쳐 `campus-data.js`를 만듦 (자료가 없는 건물의 추정 층수는 `ESTIMATED_LEVELS`)
- `scripts/fetch_official.py`: 아주대 공식 캠퍼스맵 API에서 건물 정보를 받아 OSM 건물과 위치로 짝지음
- `scripts/merge_research.py`: 조사 워크플로 저널에서 결과를 뽑아 `data/*.json`으로 저장
- `data/osm_raw.json`, `data/osm_medical.json`: Overpass API 원본 (본교 way 477523965, 병원 way 297874790 영역)

## 데이터 다시 받기
https://overpass-turbo.eu 에서 아래 쿼리를 실행해 결과를 `data/osm_raw.json`으로 저장한 뒤 `python scripts/process_osm.py`를 실행합니다.

```
[out:json][timeout:120];
way(477523965)->.c; .c map_to_area->.a;
( .c; way["building"](area.a); relation["building"](area.a);
  way["highway"](area.a); way["leisure"](area.a); way["landuse"](area.a);
  way["natural"](area.a); way["amenity"="parking"](area.a); node["name"](area.a); );
out geom;
```

## 사진·영상에서 확인해 반영한 것 (예)
| 대상 | 확인한 사실 |
|---|---|
| 팔달관 | 공식 10층(OSM 11층은 오류), 북쪽 10층 탑 + 남쪽 낮은 날개동 |
| 연암관(구 종합관) | 지하 2·지상 12층. 금속패널 탑 + 수직 핀 날개 + 청록 유리 기단, 남쪽은 옥상정원 기단 |
| 아주대학교병원 | 지하 2·지상 13층. 5층 기단 위 병동 탑, 베이지 콘크리트 격자 |
| 송재관 | 지하 1·지상 10층. 3층 기단 + 10층 탑, 계단실 분홍 세로 띠 |
| 일신관 | 2022년 신축 11층. OSM 외곽선이 실제보다 작아 위성영상으로 다시 그림 |
| 혜강관 | 2022년 7층. OSM에 빠진 북쪽 날개 보정 |
| 율곡관 | 지하 1·지상 5층 본관. 남쪽 5층·북쪽 3층, 크림 띠 + 붉은 벽돌 스팬드럴 |
| 체육관 | 청회색 아치 지붕 + 짙은 유리 외벽 |
| 선구자상 | 동쪽을 향한 기마상, 회색 화강암 받침대(예전 야간 사진의 붉은색은 조명), 정사각 계단식 수조, 십자형 벽돌 광장 |
| 디아트(노천극장) | 반원 무대 + 계단식 객석 + 무대 뒤 흰 곡면 벽 |
| 운동장 | 두 곳 모두 인조잔디(최신 위성영상) |
| 신규 반영 | 제3주차빌딩, 캠퍼스플라자, 의료캠퍼스 건물, 교문 5곳, 버스정류장, 가로등 |

## 한계
- 지형은 약 30 m 간격 위성 고도 자료 기반이라, 계단·옹벽 같은 수 m 단위 단차는 완만한 경사로 표현됩니다. VWorld API 키(무료)가 있으면 국토지리정보원 5 m 정밀 지형으로 바꿀 수 있습니다.
- 공식 자료·사진이 없는 소형 건물(해바라기센터, 임상시험센터, 창고 등)은 위성영상 기반 추정입니다(정보 패널에 신뢰도 표시).
- 부분 높이(탑 위치)는 위성영상 판독이라 팔달관·송재관 등은 신뢰도 '보통/낮음'입니다.
- 나무 위치는 실제 식재가 아니라 녹지·도로 기준 자동 배치입니다.

지도 데이터 © OpenStreetMap contributors (ODbL) · 건물 정보: 아주대학교 공식 캠퍼스맵 · 위성영상 판독: VWorld(국토교통부) · 지형: Copernicus GLO-30 DEM (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA) · 참고 사진: Wikimedia Commons (`reference-photos/credits.json`). 공식 사진과 위성영상은 분석에만 쓰고 프로젝트에 포함하지 않았습니다.
