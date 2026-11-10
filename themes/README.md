# 主题商店 · 怎么上传（只有站长能做）

商店是**静态目录**：网页只读 `themes/index.json`，用户点「下载并套用」时才去拉 `themes/<id>.theme.json` 那一份。没人能通过网页上传，只有能往仓库部署文件的人（也就是你）能上新主题。

## 上一个新主题

1. 在本机网页里把外观调好（皮肤 / 主题色 / 深浅 / 背景 / 磨砂 / 发光 / 面板不透明度）。
2. 设置页 →「💾 存成主题包」→ 起名 → 会下载一个 `名字.theme.json`。
3. 把这个文件放进本目录，文件名建议用 id：`themes/<id>.theme.json`。
4. 打开 `themes/index.json`，在 `themes` 数组最前面加一条：

```json
{
  "id": "my-theme",
  "name": "显示名",
  "author": "站长",
  "style": "glass",          // 这套用的皮肤（style）
  "theme": "dark",           // light / dark / auto
  "desc": "一句话说明",
  "file": "themes/my-theme.theme.json",
  "swatch": { "bg": "底色或渐变", "card": "卡片色", "accent": "主色", "text": "文字色" }
}
```

5. 部署：`gh-pages-deploy.mjs --repo stain37/shuati-web --no-pdf`，升一下 `sw.js` 的 `webNNN`。
6. 用户打开「🛍 主题商店」就能看到，点「下载并套用」才会下载这一个文件。

## 主题包长什么样

```json
{
  "v": 1, "id": "…", "name": "…", "author": "站长", "desc": "…", "tags": [],
  "look": { "style": "…", "color": "…", "theme": "…", "bg": "…", "fs": "m",
            "frost": true, "frostPx": 14, "uiAlpha": 1, "glowMode": "auto",
            "glowColor": "", "autoContrast": true, "uiText": "auto",
            "uiTextPick": "#0b1220", "reduceMotion": false },
  "css": "可选的整段 CSS（会注入到一个 <style id=\"themePackCss\"> 里）"
}
```

- 只影响「外观」，不动题库 / 作答 / 收藏这些数据。
- `css` 里如果要用 id 做作用域，用 `html[data-theme-pack="<id>"]` 前缀，避免和别的主题打架。
- 主题包不要引用外部图片；要背景图请用站内的 `bg`（default / aurora / paper…）或 dataURL，但别超过 1MB。
