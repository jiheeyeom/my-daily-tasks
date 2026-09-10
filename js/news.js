import { safeUrl } from "./domain.js";

export async function refreshPublicContent(doc, fetcher = fetch) {
  // Quotes ship with the site: same origin, so no proxy and nothing to fail.
  // Collected by scripts/fetch_quotes.py from Wikiquote, which carries the
  // attribution with each line.
  const quotesUrl = "./data/quotes.json";
  const json = async (url) => {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(12000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("공개 자료를 불러오지 못했습니다.");
    return response.json();
  };
  const quote = async () => {
    try {
      const rows = await json(quotesUrl);
      const usable = Array.isArray(rows)
        ? rows.filter((row) => row && typeof row.text === "string")
        : [];
      if (!usable.length) return;
      const pick = usable[Math.floor(Math.random() * usable.length)];
      const credit = [pick.author, pick.work && `\u300E${pick.work}\u300F`]
        .filter(Boolean)
        .join(", ");
      // The Korean line leads and the original always follows, so the wording
      // can be checked against the source it is credited to.
      const lead = pick.ko || pick.text;
      // textContent throughout: a quote is data, never markup.
      doc.getElementById("daily-quote").textContent = credit
        ? `${lead} \u2014 ${credit}`
        : lead;
      const origin = doc.getElementById("daily-quote-origin");
      origin.textContent = pick.ko ? `\u201C${pick.text}\u201D` : "";
      origin.hidden = !pick.ko;
    } catch {
      /* Keep the local fallback. Public feeds never block private data. */
    }
  };

  // The feeds themselves send no Access-Control-Allow-Origin and every free
  // CORS proxy we relied on has gone dark, so a scheduled job collects them
  // into a file on our own origin. See scripts/fetch_news.py.
  const NEWS_URL = "./data/news.json";
  const LISTS = ["kr-news-list", "bbc-news-list"];
  // Google News turns over many times a day, so headlines that have not moved
  // in three days mean the job has stopped, not that the world went quiet.
  const STALE_MS = 3 * 24 * 60 * 60 * 1000;

  const fail = (message) => {
    for (const id of LISTS) {
      const row = doc.createElement("li");
      row.textContent = "뉴스를 불러오지 못했습니다.";
      doc.getElementById(id).replaceChildren(row);
    }
    doc.getElementById("daily-news").textContent = message;
  };

  const news = async () => {
    let data;
    try {
      data = await json(NEWS_URL);
    } catch {
      fail("뉴스는 잠시 쉬는 중입니다.");
      return;
    }
    const feeds = data?.feeds ?? {};
    let headline = "";
    for (const id of LISTS) {
      const list = doc.getElementById(id);
      // Generated from third-party feeds, so it is checked again here: being
      // same-origin makes it reachable, not trustworthy.
      const items = (Array.isArray(feeds[id]) ? feeds[id] : [])
        .map((row) => ({
          title: typeof row?.title === "string" ? row.title : "",
          url: safeUrl(row?.url),
        }))
        .filter((row) => row.title && row.url)
        .slice(0, 10);
      if (!items.length) {
        const row = doc.createElement("li");
        row.textContent = "뉴스를 불러오지 못했습니다.";
        list.replaceChildren(row);
        continue;
      }
      list.replaceChildren();
      for (const item of items) {
        const row = doc.createElement("li"),
          link = doc.createElement("a");
        // textContent throughout: a headline is data, never markup.
        link.textContent = item.title;
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.append(link);
        list.append(row);
      }
      if (id === LISTS[0]) headline = items[0].title;
    }
    const collected = Date.parse(data?.generatedAt ?? "");
    const stale =
      Number.isFinite(collected) && Date.now() - collected > STALE_MS;
    doc.getElementById("daily-news").textContent = !headline
      ? "뉴스는 잠시 쉬는 중입니다."
      : stale
        ? `${new Date(collected).toLocaleDateString("ko-KR")} 이후 갱신이 멈춰 있어요 · ${headline}`
        : `오늘의 뉴스 · ${headline}`;
  };

  await Promise.all([quote(), news()]);
}
