# Recipe Vault

A personal recipe manager that extracts recipes from TikTok, Instagram, YouTube, and recipe websites, with menu planning and occasion-based rating.

---

## Architecture

```
Browser (React/Next.js)
  │
  ├── /api/metadata  ← Vercel serverless function
  │     Fetches TikTok oEmbed / Instagram oEmbed / Open Graph
  │     server-side (bypasses CORS restrictions)
  │
  ├── api.anthropic.com  ← Claude extracts recipe from metadata
  │
  └── Firestore  ← Stores recipes, categories, ratings
```

---

## Setup: 5 steps

### 1. Clone and install

```bash
git clone <this-repo>
cd recipe-vault
npm install
```

### 2. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Add a **Web app** (the `</>` icon)
4. Copy the config object — you'll paste it into the app on first launch
5. Go to **Firestore Database** → Create database → Start in **test mode**

### 3. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Follow the prompts. Vercel auto-detects Next.js.

Your app will be live at `https://your-app.vercel.app`.

### 4. (Optional) Instagram token for better Instagram extraction

Without a token, Instagram falls back to Open Graph scraping (works for most public posts).

For full Instagram oEmbed support:
1. Create a [Facebook Developer App](https://developers.facebook.com/)
2. Get an access token with `instagram_oembed` permission
3. In Vercel dashboard → Settings → Environment Variables, add:
   - Key: `INSTAGRAM_TOKEN`
   - Value: your token

### 5. Open the app

On first launch, paste your Firebase config JSON. The app stores it in localStorage — you only do this once.

---

## Usage

**Adding a recipe:**
1. Copy a TikTok, Instagram, or recipe website URL
2. Open the app — the clipboard banner appears automatically
3. Tap **Add** → the proxy fetches metadata → Claude extracts the full recipe
4. Choose categories, save

**Planning a menu:**
1. Tap **Plan Menu**
2. Enter occasion, guest count, style
3. Claude builds a menu from your saved recipes, weighted by rating

**Rating recipes:**
- Open any recipe → tap stars after cooking
- Ratings influence menu suggestions (higher-rated = prioritized)

---

## How the extraction works

```
URL pasted
  → /api/metadata (serverless, no CORS)
       TikTok: fetch https://www.tiktok.com/oembed?url=...
               returns: title (caption), thumbnail_url, author_name
       Instagram: graph.facebook.com/instagram_oembed (if token set)
                  OR scrape Open Graph tags
       YouTube: youtube.com/oembed
       Websites: scrape Open Graph + first 8000 chars of page text
  → Claude receives: title, caption, description, page text
  → Returns: name, ingredients[], instructions[], servings, times, cuisine
```

TikTok captions often contain the full ingredient list. When they don't,
Claude uses culinary knowledge to fill gaps and marks confidence as "low"
with a visible warning.

---

## Firestore collections

| Collection | Document structure |
|---|---|
| `recipes` | name, ingredients[], instructions[], thumbnail, videoUrl, categories[], ratings[], avgRating, cuisine, platform, createdAt |
| `categories` | id, name |

---

## Local development

```bash
npm run dev
# → http://localhost:3000
```

The `/api/metadata` function runs locally via Next.js API routes.
