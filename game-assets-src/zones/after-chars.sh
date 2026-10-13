#!/usr/bin/env bash
# 캐릭터 원화 배치(gpt 웹 프로필 1슬롯)가 끝난 뒤 세계 배경을 뽑는다
while kill -0 66892 2>/dev/null; do sleep 15; done
exec ~/.claude/skills/game-builder/tools/gb-image.sh game-assets-src/zones/jobs.jsonl
