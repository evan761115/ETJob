// server.js
// 專題方向產生器 - 後端服務（Node.js + Express + Claude API + 維基百科）
//
// 這支後端接收前端送來的「熱事件」文字，流程如下：
//   1. 先查詢維基百科（zh.wikipedia.org），取得與事件相關的公開資料當作寫作素材
//   2. 呼叫 Anthropic Claude API，請模型依「倒金字塔寫作」＋「金字塔原理」撰寫新聞稿草稿，
//      並依 Google SEO 邏輯產出 10 則 ETtoday 風格的建議標題（5短5長）
//   3. 以固定 JSON 格式回傳給前端
//
// 部署方式請參考 README.md（推薦 Render / Railway，不建議用 GitHub Pages
// 部署後端，因為 GitHub Pages 只能放靜態網頁）。

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ------------------------------------------------------------------
// CORS 設定
// 若你想限制只有自己的 GitHub Pages 網域可以呼叫這支後端，
// 把 ALLOWED_ORIGIN 環境變數設成你的網址，例如：
//   ALLOWED_ORIGIN=https://your-github-username.github.io
// 不設定的話預設全部開放（方便測試，正式上線建議設定）。
// ------------------------------------------------------------------
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin ? allowedOrigin : "*",
  })
);

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
// 注意：模型代號可能隨時間更新，請至
// https://docs.claude.com/en/docs/about-claude/models 確認目前可用的模型代號，
// 並視需要修改上面這行或設定 ANTHROPIC_MODEL 環境變數。

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[警告] 尚未設定 ANTHROPIC_API_KEY 環境變數，/api/generate 會回傳錯誤。請參考 .env.example。"
  );
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ------------------------------------------------------------------
// 維基百科查詢：抓取與熱事件相關的公開資料，當作寫稿素材（避免模型憑空捏造細節）
// ------------------------------------------------------------------
const WIKI_API = "https://zh.wikipedia.org/w/api.php";
const WIKI_EXTRACT_MAX_LEN = 2500; // 每筆來源最多保留的字數，避免 prompt 過長
const WIKI_MAX_SOURCES = 2; // 最多引用幾筆維基百科條目

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchWikipediaContext(query) {
  try {
    const searchUrl =
      `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
      `&srlimit=${WIKI_MAX_SOURCES}&format=json&origin=*&variant=zh-tw`;
    const searchRes = await fetchWithTimeout(searchUrl, 6000);
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const results = (searchData.query && searchData.query.search) || [];
    if (!results.length) return [];

    const pageIds = results.map((r) => r.pageid).join("|");
    const extractUrl =
      `${WIKI_API}?action=query&prop=extracts&explaintext=1&exsectionformat=plain` +
      `&pageids=${pageIds}&format=json&origin=*&variant=zh-tw`;
    const extractRes = await fetchWithTimeout(extractUrl, 8000);
    if (!extractRes.ok) return [];
    const extractData = await extractRes.json();
    const pages = (extractData.query && extractData.query.pages) || {};

    return Object.values(pages)
      .filter((p) => p.extract)
      .map((p) => ({
        title: p.title,
        url: "https://zh.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")),
        extract: p.extract.slice(0, WIKI_EXTRACT_MAX_LEN),
      }));
  } catch (err) {
    console.warn("[維基百科查詢失敗]", err.message);
    return [];
  }
}

// ------------------------------------------------------------------
// System Prompt：把主管的判斷邏輯、寫作規範與範例寫進去，讓模型模仿這種思考方式
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `你是 ETtoday 星光雲（娛樂新聞）的資深主管，負責在熱事件發生時，
快速幫組員（記者）想出「專題方向」，並直接產出可參考、可加工的新聞稿草稿與標題建議。

使用者會提供「熱事件」，以及從維基百科查到的相關公開資料（可能查無資料）。
請完成以下三項任務，並透過 return_topic_directions 這個工具回傳結果（不要用一般文字回覆）：

【任務一：專題方向規劃】
規劃至少 3 則具體稿件方向，每則都要包含：
- type：稿件類型，只能從以下擇一：「懶人包」「整理稿」「評論稿」「深度報導」「專訪企劃」「數據分析」
- title：這則稿件的內部工作標題（給編輯台辨識用，非正式對外標題）
- angle：給記者的寫作提示，說明這則稿子該寫什麼重點、切入角度
這 3 則以上稿件中，「懶人包」或「整理稿」至少要有 1 則，「評論稿」也至少要有 1 則。
另外規劃至少 5 則「更多延伸出稿方向」，一句話描述即可，作為備用選題。

思考時可參考主管過去指派任務的邏輯，例如：
- 藝人感情/婚姻類事件：適合「事件懶人包」「過往感情整理」「當事人動機／背後意義評論」
- 戲劇/戲劇圈事件：適合「爆紅原因與數據整理」「主要演員背景整理」「劇中細節/彩蛋整理」
- 資深藝人/長壽節目類事件：適合「節目沿革懶人包」「幕後甘苦談整理」「節目對社會/產業意義的評論」

【任務二：撰寫新聞稿草稿（body）】
針對上面規劃的每一則稿件方向，實際撰寫一篇新聞稿草稿，規則如下：
- 綜合使用者提供的維基百科公開資料與你的知識，但**不可整段照抄維基百科原文**，
  必須消化後用自己的話重新組織、改寫，避免抄襲與侵權疑慮；若查無維基百科資料，
  可依常識合理鋪陳，但不要捏造具體數字、日期或引語，可在內容中提醒「（此處請記者查證最新資訊）」。
- 寫作結構同時採用「倒金字塔寫作法」與「金字塔原理」：
  1. lead（導言）：開門見山，先給結論／最重要的事實（5W1H：誰、何事、何時、何地、為何、如何），
     讓讀者只看導言就能掌握整則新聞核心，字數約 100-150 字。
  2. sections（分段內容）：切成 2-4 個段落區塊，每個區塊要有一個「分段小標（heading）」，
     依重要性由高到低排列，各區塊內容彼此獨立、互不重複，合起來涵蓋完整資訊（MECE 原則）。
     次要背景資料（例如人物基本資料、歷史沿革）建議放在最後一個區塊。
- 全文使用繁體中文（台灣用語），語氣為新聞報導語氣；「評論稿」類型可以有明確觀點與論述，
  其他類型應保持客觀、避免第一人稱與過度主觀字眼。

【任務三：SEO 建議標題（headlines）】
針對上面每一則稿件，依 Google SEO 邏輯，產出「剛好 10 個」建議標題：
- 其中 5 則 length 為 "short"：長度約 15 個中文字（12-17字皆可）
- 其中 5 則 length 為 "long"：長度約 25 個中文字（22-28字皆可）
- SEO 撰寫原則：
  - 重要關鍵字（人名、事件、作品名）盡量放在標題前段
  - 標題具體明確，避免「最新消息」「太震驚了」這種空泛詞彙
  - 避免關鍵字堆疊、避免誇大不實或標題與內容不符（clickbait）
  - 可視情況使用數字、問句等提高點擊率的手法，但仍須忠於事實
- 所有標題都要符合「ETtoday 風格」：常見手法包含使用人物全名、用引號呈現當事人說法、
  使用「驚爆」「認了」「曝」「這樣說」「怎麼回事」等娛樂新聞常見動詞或語氣詞，
  但不使用聳動失真、與內容不符的用語。

請注意：全部使用繁體中文（台灣用語），內容盡量具體，針對輸入的事件本身發想，不要寫空泛的通用句子。`;

const TOOL_SCHEMA = {
  name: "return_topic_directions",
  description: "回傳專題方向、新聞稿草稿與 SEO 標題建議",
  input_schema: {
    type: "object",
    properties: {
      articles: {
        type: "array",
        minItems: 3,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "稿件內部工作標題" },
            type: {
              type: "string",
              enum: ["懶人包", "整理稿", "評論稿", "深度報導", "專訪企劃", "數據分析"],
            },
            angle: { type: "string", description: "給記者的寫作提示與切入角度" },
            body: {
              type: "object",
              description: "新聞稿草稿正文",
              properties: {
                lead: { type: "string", description: "導言，開門見山先給結論（約100-150字）" },
                sections: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      heading: { type: "string", description: "分段小標" },
                      content: { type: "string", description: "該段落內容" },
                    },
                    required: ["heading", "content"],
                  },
                },
              },
              required: ["lead", "sections"],
            },
            headlines: {
              type: "array",
              minItems: 10,
              maxItems: 10,
              description: "10則SEO建議標題，5則short、5則long",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  length: { type: "string", enum: ["short", "long"] },
                },
                required: ["text", "length"],
              },
            },
          },
          required: ["title", "type", "angle", "body", "headlines"],
        },
      },
      moreDirections: {
        type: "array",
        minItems: 5,
        items: { type: "string" },
        description: "更多延伸出稿方向，每則一句話",
      },
    },
    required: ["articles", "moreDirections"],
  },
};

app.get("/health", (req, res) => {
  res.json({ ok: true, model: MODEL });
});

app.post("/api/generate", async (req, res) => {
  const event = (req.body && req.body.event ? String(req.body.event) : "").trim();

  if (!event) {
    return res.status(400).json({ error: "請提供 event 欄位（熱事件關鍵字）" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "後端尚未設定 ANTHROPIC_API_KEY，請通知系統管理員" });
  }

  try {
    const wikiEntries = await fetchWikipediaContext(event);

    const wikiContextText = wikiEntries.length
      ? wikiEntries
          .map((e) => `【來源：${e.title}】\n${e.extract}`)
          .join("\n\n")
      : "（查無相關維基百科資料，請主要依常識合理鋪陳，避免捏造具體數字、日期或引語，並在草稿中提醒記者查證最新資訊）";

    const userMessage =
      `熱事件：${event}\n\n` +
      `以下是從維基百科查到、可能相關的公開資料（請整理、改寫、去蕪存菁後使用，` +
      `不要整段照抄原文字句）：\n\n${wikiContextText}\n\n` +
      `請依照系統提示的規則，完整產出：\n` +
      `1. 至少3則稿件方向（title/type/angle）\n` +
      `2. 每則稿件方向的完整新聞稿草稿（body：含導言與2-4個分段小標）\n` +
      `3. 每則稿件方向剛好10則SEO建議標題（headlines：5則short＋5則long，ETtoday風格）\n` +
      `4. 至少5則更多延伸出稿方向（moreDirections）`;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "return_topic_directions" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");

    if (!toolUse) {
      return res.status(502).json({ error: "模型未回傳預期格式，請稍後再試" });
    }

    const result = toolUse.input;

    // 基本防呆：確保至少有 3 則稿件與 5 則延伸方向，且每則稿件都有草稿與標題
    if (!Array.isArray(result.articles) || result.articles.length < 3) {
      return res.status(502).json({ error: "模型回傳的稿件方向不足 3 則，請重新產生" });
    }
    if (!Array.isArray(result.moreDirections) || result.moreDirections.length < 5) {
      return res.status(502).json({ error: "模型回傳的延伸方向不足 5 則，請重新產生" });
    }
    const incomplete = result.articles.find(
      (a) =>
        !a.body ||
        !a.body.lead ||
        !Array.isArray(a.body.sections) ||
        a.body.sections.length < 2 ||
        !Array.isArray(a.headlines) ||
        a.headlines.length < 10
    );
    if (incomplete) {
      return res.status(502).json({ error: "模型回傳的新聞稿草稿或標題不完整，請重新產生" });
    }

    res.json({
      event,
      articles: result.articles,
      moreDirections: result.moreDirections,
      wikipedia: wikiEntries.map((e) => ({ title: e.title, url: e.url })),
    });
  } catch (err) {
    console.error("Claude API 呼叫失敗：", err);
    res.status(500).json({ error: "呼叫 Claude API 時發生錯誤：" + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`專題方向產生器後端已啟動，監聽 port ${PORT}`);
});
