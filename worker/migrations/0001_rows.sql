-- 오르답 일일 등수 — 기록 한 줄 = 한 행. (2026-10-08 KV → D1: gmail 계정 KV 목록 조회가 하루 상한 1,000회를 넘었다)
-- 🔴 기본키에 점수까지 넣는다 — KV 시절 rowKey 와 같은 뜻: 다른 기록은 다른 행이라 덮어쓰기가 없다.
CREATE TABLE IF NOT EXISTS rows (
  day TEXT NOT NULL,      -- 한국 날짜(YYYY-MM-DD) · 봇 줄은 't-YYYY-MM-DD'
  sub TEXT NOT NULL,      -- 과목:모드
  n   TEXT NOT NULL,      -- 가린 이름
  s   INTEGER NOT NULL,   -- 층
  at  INTEGER NOT NULL,   -- 제출 시각(ms)
  PRIMARY KEY (day, sub, n, s)
) WITHOUT ROWID;
