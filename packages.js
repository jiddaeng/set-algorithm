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
    study: {
        label: "Study Pack",
        include: [
            "study",
            "study with me",
            "studying",
            "공부",
            "공부 브이로그",
            "스터디",
            "focus",
            "focused",
            "deep work",
            "pomodoro",
            "집중",
            "exam",
            "test",
            "수능",
            "내신",
            "시험",
            "lecture",
            "class",
            "강의",
            "인강",
            "공부법",
            "productivity",
            "productive",
            "time management"
        ],
        exclude: [
            "game",
            "gaming",
            "minecraft",
            "롤",
            "발로란트",
            "배틀그라운드",
            "먹방",
            "mukbang",
            "아이돌",
            "reaction",
            "prank",
            "예능",
            "shorts",
            "챌린지",
            "몰카",
            "classic"
        ]
    },
    workout: {
        label: "Workout Pack",
        include: [
            "workout",
            "fitness",
            "exercise",
            "운동",
            "헬스",
            "루틴",
            "피트니스",
            "home workout",
            "bodybuilding",
            "muscle"
        ],
        exclude: [
            "game",
            "gaming",
            "먹방",
            "예능",
            "shorts",
            "reaction"
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
            "개발",
            "프로그래밍",
            "코딩",
            "프로젝트",
            "강의",
            "튜토리얼"
        ],
        exclude: [
            "game",
            "gaming",
            "먹방",
            "예능",
            "shorts",
            "reaction"
        ]
    },
    reading: {
        label: "Reading Pack",
        include: [
            "reading",
            "book",
            "books",
            "독서",
            "책",
            "지식",
            "self development",
            "자기계발",
            "learning",
            "essay"
        ],
        exclude: [
            "game",
            "gaming",
            "먹방",
            "예능",
            "shorts",
            "reaction"
        ]
    }
};

const DEFAULT_PACKAGE = "study";
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