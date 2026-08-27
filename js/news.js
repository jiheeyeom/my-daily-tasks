import { safeUrl } from "./domain.js";

export async function refreshPublicContent(doc, fetcher = fetch) {
  const quotesUrl =
    "https://gist.githubusercontent.com/jiheeyeom/c9982ac10450b4c9bfda8cebe11213e9/raw/9de789bff7cdb6a1a662de2f3521cdb6c7197832/quotes.json";
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
      const texts = Array.isArray(rows)
        ? rows.filter((row) => typeof row === "string")
        : [];
      if (texts.length)
        doc.getElementById("daily-quote").textContent =
          texts[Math.floor(Math.random() * texts.length)];
    } catch {
      /* Keep the local fallback. Public feeds never block private data. */
    }
  };
  const news = async (id, url) => {
    const list = doc.getElementById(id);
    try {
      const data = await json(
        `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      );
      const xml = new doc.defaultView.DOMParser().parseFromString(
        data.contents,
        "text/xml",
      );
      if (xml.querySelector("parsererror")) throw new Error("Invalid RSS");
      const items = [...xml.querySelectorAll("item")]
        .slice(0, 10)
        .map((item) => ({
          title: item.querySelector("title")?.textContent || "제목 없음",
          url: safeUrl(item.querySelector("link")?.textContent),
        }))
        .filter((item) => item.url);
      if (!items.length) throw new Error("Empty RSS");
      list.replaceChildren();
      for (const item of items) {
        const row = doc.createElement("li"),
          link = doc.createElement("a");
        link.textContent = item.title;
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.append(link);
        list.append(row);
      }
      if (id === "kr-news-list")
        doc.getElementById("daily-news").textContent =
          `오늘의 뉴스 · ${items[0].title}`;
    } catch {
      const row = doc.createElement("li");
      row.textContent = "뉴스를 불러오지 못했습니다.";
      list.replaceChildren(row);
      if (id === "kr-news-list")
        doc.getElementById("daily-news").textContent =
          "뉴스는 잠시 쉬는 중입니다.";
    }
  };
  await Promise.all([
    quote(),
    news("kr-news-list", "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko"),
    news("bbc-news-list", "https://feeds.bbci.co.uk/news/rss.xml"),
  ]);
}
