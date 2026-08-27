#!/bin/bash

# 사용법 안내 함수
usage() {
  echo "Usage:"
  echo "  gpush             : 제미나이가 생성한 메시지로 커밋/푸시"
  echo "  gpush -a \"메시지\" : 제미나이 메시지 뒤에 ,[User] 내 메시지 추가 (Case 1)"
  echo "  gpush -m \"메시지\" : [User] 접두어와 함께 내 메시지로만 커밋 (Case 2)"
  exit 1
}

# 1. 옵션 파싱
ADD_MSG=""
ONLY_MSG=""

while getopts "a:m:" opt; do
  case $opt in
    a) ADD_MSG="$OPTARG" ;; # Case 1: Append mode
    m) ONLY_MSG="$OPTARG" ;; # Case 2: Manual mode
    *) usage ;;
  esac
done

# 2. 변경된 파일이 있는지 확인
if [ -z "$(git status --porcelain)" ]; then
  echo "❌ 변경된 사항이 없습니다."
  exit 0
fi

# 3. 커밋 메시지 결정 로직
if [ -n "$ONLY_MSG" ]; then
  # [Case 2] 사용자 메시지 전용: [User] 접두어
  FINAL_MSG="[User] $ONLY_MSG"
  echo "👤 사용자 직접 명령으로 진행합니다: $FINAL_MSG"
else
  # 제미나이 분석 실행
  echo "🤖 제미나이가 변경 사항을 분석 중입니다..."
  AI_MSG=$(git diff HEAD | python3 /app/scripts/generate_commit_msg.py)

  if [ -z "$AI_MSG" ] || [[ "$AI_MSG" == AI*Error* ]]; then
    echo "❌ 커밋 메시지 생성에 실패했습니다: $AI_MSG"
    exit 1
  fi

  if [ -n "$ADD_MSG" ]; then
    # [Case 1] AI 메시지 + , [User] 사용자 메시지 추가
    FINAL_MSG="${AI_MSG}, [User] ${ADD_MSG}"
    echo "📝 메시지 조합 완료: $FINAL_MSG"
  else
    # [Default] 제미나이 메시지만 사용
    FINAL_MSG="$AI_MSG"
    echo "📝 제미나이 메시지 사용: $FINAL_MSG"
  fi
fi

# 4. Git 작업 수행
git add .
git commit -m "$FINAL_MSG"
git push origin main

echo "✅ 성공적으로 Push 되었습니다!"