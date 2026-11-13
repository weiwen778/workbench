"""Static source catalog for the information hub.

Hot sources are fetched by the backend. Common links are opened in the user's
browser and never carry a refresh status.
"""
from __future__ import annotations

HOT_SECTIONS = [
    {"key": "domestic", "label": "国内热榜", "description": "微博、知乎、B 站各自保留平台原榜单顺序"},
    {"key": "overseas", "label": "海外热榜", "description": "美国搜索趋势，只有来源提供排名时才显示名次"},
]

HOT_SOURCES: dict[str, dict] = {
    "weibo": {
        "id": "weibo", "section": "domestic", "label": "微博热搜", "platform": "微博",
        "type_label": "热搜榜", "route": "weibo", "homepage": "https://s.weibo.com/top/summary/",
        "provider_hint": "DailyHotApi / 微博公开热搜接口",
    },
    "zhihu": {
        "id": "zhihu", "section": "domestic", "label": "知乎热榜", "platform": "知乎",
        "type_label": "热榜", "route": "zhihu", "homepage": "https://www.zhihu.com/hot",
        "provider_hint": "DailyHotApi / 知乎公开热榜接口",
    },
    "bilibili": {
        "id": "bilibili", "section": "domestic", "label": "B 站热门", "platform": "哔哩哔哩",
        "type_label": "热门", "route": "bilibili", "homepage": "https://www.bilibili.com/v/popular/rank/all",
        "provider_hint": "DailyHotApi / 哔哩哔哩热门接口",
    },
    "google-trends-us": {
        "id": "google-trends-us", "section": "overseas", "label": "Google Trends 美国",
        "platform": "Google", "type_label": "美国搜索趋势", "route": "google-trends-us",
        "homepage": "https://trends.google.com/trending?geo=US",
        "provider_hint": "Google Trends 美国 Trending Now RSS",
    },
}

HOT_SOURCE_IDS = list(HOT_SOURCES)

DIRECT_PROVIDERS = {
    "weibo": "微博公开热搜接口",
    "zhihu": "知乎公开热榜接口",
    "bilibili": "哔哩哔哩热门接口",
}

DEFAULT_SUBSCRIPTIONS = [
    {
        "key": "hacker-news",
        "url": "https://hnrss.org/frontpage",
        "title": "Hacker News",
        "kind": "rss",
        "note": "优先打开条目原文，讨论页作为附加链接",
    },
    {
        "key": "openai-news",
        "url": "https://openai.com/news/rss.xml",
        "title": "OpenAI News",
        "kind": "rss",
        "note": "OpenAI 官方新闻 RSS",
    },
]

COMMON_GROUPS = [
    {
        "key": "cross-border",
        "label": "跨境平台公告",
        "description": "关注商品发布、物流履约、半托管及活动报名；需要登录的页面在浏览器中打开，沿用你自己的平台登录流程。",
        "items": [
            {
                "key": "alibaba-rules",
                "title": "阿里国际站规则中心",
                "platform": "Alibaba.com",
                "url": "https://rulechannel.alibaba.com/icbu",
                "note": "入口路径：My Alibaba → 服务中心 → 规则中心。首次打开可能需要登录。",
            },
            {
                "key": "1688-rules",
                "title": "1688 规则中心",
                "platform": "1688",
                "url": "https://rule.1688.com/",
                "note": "商品发布、交易履约、活动规则与平台公告。",
            },
            {
                "key": "temu-seller",
                "title": "TEMU 卖家中心",
                "platform": "TEMU",
                "url": "https://seller.kuajingmaihuo.com/",
                "note": "卖家后台需要登录；公告、半托管和活动报名以站内实际页面为准。",
            },
        ],
    },
    {
        "key": "consumer-trends",
        "label": "海外消费趋势",
        "description": "用于观察季节性搜索、礼品风格和商品灵感。",
        "items": [
            {
                "key": "pinterest-trends",
                "title": "Pinterest Trends",
                "platform": "Pinterest",
                "url": "https://trends.pinterest.com/",
                "note": "官方趋势查询入口；可按关键词和地区自行筛选。",
            },
        ],
    },
    {
        "key": "events",
        "label": "赛事与节日",
        "description": "赛事搜索和节日日历入口。自动获取赛事与按地区、月份筛选留待后续。",
        "items": [
            {
                "key": "runsignup",
                "title": "RunSignup 赛事查询",
                "platform": "RunSignup",
                "url": "https://runsignup.com/Races",
                "note": "按地点、日期和项目自行搜索赛事。",
            },
            {
                "key": "timeanddate-us",
                "title": "timeanddate 美国节日日历",
                "platform": "timeanddate",
                "url": "https://www.timeanddate.com/holidays/us/",
                "note": "美国联邦与常见节日日历；可按年份和地区查看。",
            },
        ],
    },
]

COMMON_BY_KEY = {
    item["key"]: item
    for group in COMMON_GROUPS
    for item in group["items"]
}
