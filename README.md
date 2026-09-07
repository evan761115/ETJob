# 專題方向產生器｜ETtoday 星光雲

輸入一個熱事件（例如「吳宗憲離婚」），自動產出：

- 至少 3 則具體稿件方向（標題＋類型＋寫作切角），其中一定包含「懶人包／整理稿」與「評論稿」
- **每則稿件方向的完整新聞稿草稿**：後端會先查詢維基百科取得公開資料，再請 Claude 依「倒金字塔寫作法」＋
  「金字塔原理」寫成有導言、有分段小標的新聞稿草稿
- **每則稿件方向的 10 個 SEO 建議標題**：依 Google SEO 邏輯產出 5 則短標（約15字）＋ 5 則長標（約25字），
  皆為 ETtoday 風格標題
- 至少 5 則更多延伸出稿方向

給組員（記者）快速發想選題、加速寫稿使用。

> ⚠️ 新聞稿草稿與標題都是 AI 依公開資料整理的初稿，正式刊登前務必由記者查證最新資訊、
> 補充當事人／官方回應，並重新改寫，避免直接照抄來源或照登草稿（前端頁面上也有這段提醒）。

## 專案結構

```
topic-generator/
├── index.html        前端網頁（純 HTML/CSS/JS，無需建置，直接部署到 GitHub Pages）
├── server.js          後端服務（Node.js + Express + Claude API）
├── package.json        後端依賴套件清單
├── .env.example       後端環境變數範例（複製成 .env 使用）
└── .gitignore
```

前端和後端是**分開部署**的兩個東西：

- **前端 `index.html`**：純靜態網頁，可以直接放到 GitHub Pages。
- **後端 `server.js`**：需要跑 Node.js 伺服器、對外呼叫維基百科 API 與 Claude API，
  **GitHub Pages 無法跑後端**，需要另外找一個可以跑 Node.js 的地方部署（推薦 Render，步驟見下方）。
  部署環境需要能連上外部網路（`zh.wikipedia.org` 與 Anthropic API），大部分雲端平台（Render/Railway等）預設都可以。

---

## 一、部署後端（Render，免費方案即可）

1. 到 [Anthropic Console](https://console.anthropic.com/) 申請/確認你的 API Key（就是你已經申請的那組）。
2. 把整個專案（或至少 `server.js`、`package.json`、`.env.example`）推到一個 **GitHub repo**（可以跟前端同一個 repo，也可以分開，兩者互不影響）。
3. 到 [Render](https://render.com/) 註冊帳號，選擇 **New + → Web Service**，連接你剛剛的 GitHub repo。
4. 設定：
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Environment Variables**（在 Render 後台的 Environment 頁籤新增）：
     - `ANTHROPIC_API_KEY` = 你的 Claude API Key
     - `ANTHROPIC_MODEL` = `claude-sonnet-4-5-20250929`（或至 [模型文件](https://docs.claude.com/en/docs/about-claude/models) 確認最新代號）
     - `ALLOWED_ORIGIN` = 你之後的 GitHub Pages 網址，例如 `https://your-username.github.io`（先留空也可以測試，之後再補上更安全）
5. 部署完成後，Render 會給你一個網址，例如：
   `https://ettoday-topic-generator.onrender.com`
   這就是要填進前端「後端服務網址」的網址。
6. 可以先用瀏覽器打開 `https://你的網址/health`，看到 `{"ok":true,...}` 代表後端正常運作。

> 其他選擇：Railway、Fly.io、自己的主機都可以，只要能跑 `npm install && npm start` 並且對外開放 port 即可，`server.js` 完全不需要改。

### 本機測試（選用）

```bash
npm install
cp .env.example .env
# 編輯 .env，填入你的 ANTHROPIC_API_KEY
npm start
```

啟動後預設在 `http://localhost:3000`，可以先把前端的後端網址填 `http://localhost:3000` 測試。

---

## 二、部署前端（GitHub Pages）

1. 在 GitHub 建一個新的 repo（例如 `topic-generator`）。
2. 把 `index.html` 上傳到這個 repo 的根目錄（可以連同 `server.js` 等檔案一起放，GitHub Pages 只會處理靜態檔案，不影響）。
3. （建議）打開 `index.html`，找到最上面 `<script>` 區塊裡的這一行：

   ```js
   var DEFAULT_BACKEND_URL = ""; // 例如："https://your-backend.onrender.com"
   ```

   把你在步驟一拿到的後端網址填進去，例如：

   ```js
   var DEFAULT_BACKEND_URL = "https://ettoday-topic-generator.onrender.com";
   ```

   這樣組員打開網頁就不用自己填後端網址了。（如果不先填，網頁上也有「後端服務設定」欄位可以自己貼上網址，效果一樣，只是每次重新整理頁面要重填一次。）

4. 上傳修改後，到 repo 的 **Settings → Pages**：
   - Source 選擇 **Deploy from a branch**
   - Branch 選 `main`，資料夾選 `/ (root)`
   - 存檔後等 1-2 分鐘，GitHub 會給你一個網址，例如：
     `https://your-username.github.io/topic-generator/`
5. 打開這個網址，輸入熱事件、按「產生專題方向」，就會呼叫你的後端、透過 Claude API 產出結果。

---

## 三、CORS 提醒

前端（GitHub Pages 網域）呼叫後端（Render 網域）是跨網域請求，`server.js` 已經內建 `cors` 套件處理。
如果你在後端環境變數設定了 `ALLOWED_ORIGIN`，請確定填的是**完全對應**的前端網址（含 `https://`，不要有結尾斜線），
例如 `https://your-username.github.io`，否則瀏覽器會擋下請求。

---

## 四、新聞稿草稿與標題是怎麼產生的？

1. 後端收到熱事件文字後，會先呼叫維基百科搜尋 API（`zh.wikipedia.org`），
   找出最相關的 1-2 篇條目並取出內文（`fetchWikipediaContext`函式），當作寫作素材。
   若查無資料，會改用一段提示文字，請模型依常識合理鋪陳、不要捏造具體數字或引語。
2. 把維基百科資料連同「熱事件」一起送給 Claude API，並用 `tools`（function calling）
   強制模型依固定 JSON 結構回傳，包含每則稿件的 `body`（導言＋分段小標）與 `headlines`（10則標題）。
3. `SYSTEM_PROMPT` 裡明確要求模型：
   - 不可整段照抄維基百科原文，需改寫、去蕪存菁（避免抄襲/侵權疑慮，維基百科內容為 CC BY-SA 授權）
   - 寫作結構同時採「倒金字塔寫作法」（重要資訊在前）與「金字塔原理」（結論先行、MECE分組）
   - 標題依 Google SEO 邏輯（關鍵字前置、避免空泛與堆疊關鍵字）並符合 ETtoday 風格語氣

## 五、之後想調整生成邏輯怎麼辦？

生成邏輯的「主管思維」與寫作規則都寫在 `server.js` 裡的 `SYSTEM_PROMPT` 常數，例如想強調某種稿件類型、
調整新聞稿的段落數、改變標題字數區間或語氣，都可以直接編輯這段文字，不需要改前端，重新部署後端即可生效。
若想調整維基百科查詢筆數，可修改 `WIKI_MAX_SOURCES` 常數。

---

## 六、常見問題

**Q: 網頁顯示「尚未設定後端服務網址」？**
A: 展開網頁上方「後端服務設定」，貼上你的後端網址並按「套用此網址」；或直接在 `index.html` 填好 `DEFAULT_BACKEND_URL` 再重新部署。

**Q: 按「產生專題方向」出現連線錯誤？**
A: 先按「測試連線」確認後端是否正常（`/health` 有回應）；再檢查 Render 上的環境變數 `ANTHROPIC_API_KEY` 是否正確設定；
也可能是 CORS 設定擋住了請求，檢查 `ALLOWED_ORIGIN` 是否與你的 GitHub Pages 網址一致。

**Q: Render 免費方案會不會關機？**
A: 會，免費方案閒置一段時間後會休眠，下次請求時需要幾十秒喚醒，屬正常現象。如果團隊使用頻繁，可考慮升級付費方案。

**Q: 產生的內容偶爾字數跟指定的15字/25字有點落差？**
A: 這是語言模型輸出的自然變動，屬正常現象（系統提示已要求盡量落在12-17字/22-28字區間）。
若特定需求需要精準字數，可請記者自行微調。

**Q: 查無維基百科資料時怎麼辦？**
A: 後端會照樣讓 Claude 依常識產出草稿，但系統提示已要求不捏造具體數字/日期/引語，
草稿中可能會出現「（此處請記者查證最新資訊）」的提醒，這是刻意設計，避免產出看似確定但其實是編造的內容。
