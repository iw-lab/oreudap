-- 2026-10-08 교차검증(codex·meta): 갱신마다 행이 늘면 하루치 GROUP BY 가 읽는 행이 끝없이 는다.
-- 이름·과목당 «최고 한 줄»로 바꾼다 — 높은 기록만 올리는 원자 upsert(ON CONFLICT … WHERE excluded.s > s)라
-- 동시 제출이 낮은 점수로 덮을 수 없다. 0001 표는 배포 전이라 비어 있다(지워도 잃는 것 없음).
DROP TABLE IF EXISTS rows;
CREATE TABLE rows (
  day TEXT NOT NULL,      -- 한국 날짜(YYYY-MM-DD) · 봇 줄은 't-YYYY-MM-DD'
  sub TEXT NOT NULL,      -- 과목:모드
  n   TEXT NOT NULL,      -- 가린 이름
  s   INTEGER NOT NULL,   -- 그날 그 이름의 최고 층
  at  INTEGER NOT NULL,   -- 최고 기록을 낸 시각(ms)
  PRIMARY KEY (day, sub, n)
) WITHOUT ROWID;
