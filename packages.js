function getCustomKeywords() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { include: [], exclude: [] };
  }

  return new Promise(resolve => {
    chrome.storage.local.get(["customKeywords"], result => {
      resolve(result.customKeywords || { include: [], exclude: [] });
    });
  });
}

const PACKAGE_CONFIG = {
  kids: {
    label: "Kids Safe Pack",
    include: [
      "kids",
      "children",
      "family",
      "education",
      "learning",
      "science",
      "story",
      "cartoon",
      "animation",
      "동요",
      "동화",
      "어린이",
      "키즈",
      "교육",
      "과학",
      "안전",
      "그림책",
      "만들기"
    ],
    exclude: [
      "adult",
      "19+",
      "violence",
      "violent",
      "fight",
      "horror",
      "scary",
      "blood",
      "weapon",
      "gun",
      "drama",
      "prank",
      "gambling",
      "casino",
      "선정",
      "폭력",
      "공포",
      "자극",
      "성인",
      "혐오",
      "무서운",
      "도박"
    ]
  },
  study: {
    label: "Study Pack",
    include: [
      "study",
      "study with me",
      "studying",
      "focus",
      "focused",
      "deep work",
      "pomodoro",
      "exam",
      "test",
      "lecture",
      "class",
      "productivity",
      "productive",
      "time management",
      "공부",
      "공부 브이로그",
      "스터디",
      "집중",
      "수능",
      "내신",
      "시험",
      "강의",
      "인강",
      "공부법",
      "필기"
    ],
    exclude: [
      "game",
      "gaming",
      "minecraft",
      "roblox",
      "battleground",
      "mukbang",
      "reaction",
      "prank",
      "shorts",
      "challenge",
      "게임",
      "로블록스",
      "마인크래프트",
      "배틀그라운드",
      "먹방",
      "아이돌",
      "예능",
      "챌린지",
      "몰카"
    ]
  },
  workout: {
    label: "Workout Pack",
    include: [
      "workout",
      "fitness",
      "exercise",
      "home workout",
      "bodybuilding",
      "muscle",
      "stretching",
      "diet",
      "운동",
      "헬스",
      "루틴",
      "스트레칭",
      "홈트",
      "근육",
      "다이어트"
    ],
    exclude: [
      "game",
      "gaming",
      "mukbang",
      "shorts",
      "reaction",
      "게임",
      "먹방",
      "예능"
    ]
  },
  development: {
    label: "Development Pack",
    include: [
      "development",
      "programming",
      "coding",
      "react",
      "javascript",
      "typescript",
      "node",
      "python",
      "project",
      "tutorial",
      "개발",
      "프로그래밍",
      "코딩",
      "프로젝트",
      "강의",
      "튜토리얼",
      "자바스크립트",
      "파이썬"
    ],
    exclude: [
      "game",
      "gaming",
      "mukbang",
      "shorts",
      "reaction",
      "게임",
      "먹방",
      "예능"
    ]
  },
  reading: {
    label: "Reading Pack",
    include: [
      "reading",
      "book",
      "books",
      "learning",
      "essay",
      "독서",
      "책",
      "지식",
      "자기계발",
      "서평",
      "문학",
      "리뷰"
    ],
    exclude: [
      "game",
      "gaming",
      "mukbang",
      "shorts",
      "reaction",
      "게임",
      "먹방",
      "예능"
    ]
  }
};

const DEFAULT_PACKAGE = "kids";
const PACKAGE_NAMES = Object.keys(PACKAGE_CONFIG);

if (typeof window !== "undefined") {
  window.PACKAGE_CONFIG = PACKAGE_CONFIG;
  window.DEFAULT_PACKAGE = DEFAULT_PACKAGE;
  window.PACKAGE_NAMES = PACKAGE_NAMES;
}

if (typeof module !== "undefined") {
  module.exports = {
    PACKAGE_CONFIG,
    DEFAULT_PACKAGE,
    PACKAGE_NAMES
  };
}
