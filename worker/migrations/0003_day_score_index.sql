-- 2026-10-08 FULL(grok·gemini): 판 조회가 그날 행을 전부 읽었다 — (day, s) 인덱스 + LIMIT 로 «보여 줄 줄만» 읽는다.
CREATE INDEX IF NOT EXISTS rows_day_s ON rows (day, s DESC);
