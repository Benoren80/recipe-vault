// /api/metadata.js
// Serverless function that fetches oEmbed data server-side (no CORS issues)
// Supports TikTok, Instagram, YouTube, and generic Open Graph fallback

export default async function handler(req, res) {
  // CORS headers so the browser can call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    let metadata = null;

    // ── TikTok ──────────────────────────────────────────────────────────────
    if (url.includes('tiktok.com')) {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const response = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeVault/1.0)',
        },
      });

      if (response.ok) {
        const data = await response.json();
        metadata = {
          platform: 'tiktok',
          title: data.title || '',
          thumbnail: data.thumbnail_url || null,
          author: data.author_name || '',
          description: data.title || '', // TikTok oEmbed returns caption in title
          embedHtml: data.html || null,
        };
      }
    }

    // ── Instagram ────────────────────────────────────────────────────────────
    else if (url.includes('instagram.com')) {
      // Instagram oEmbed requires a token for full data.
      // We try the public endpoint first; if it fails we fall back to Open Graph scrape.
      try {
        const igUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${process.env.INSTAGRAM_TOKEN || ''}`;
        const response = await fetch(igUrl);
        if (response.ok) {
          const data = await response.json();
          metadata = {
            platform: 'instagram',
            title: data.title || '',
            thumbnail: data.thumbnail_url || null,
            author: data.author_name || '',
            description: data.title || '',
          };
        }
      } catch (_) {}

      // Fallback: scrape Open Graph tags
      if (!metadata) {
        metadata = await scrapeOpenGraph(url, 'instagram');
      }
    }

    // ── YouTube ──────────────────────────────────────────────────────────────
    else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(oembedUrl);
      if (response.ok) {
        const data = await response.json();
        metadata = {
          platform: 'youtube',
          title: data.title || '',
          thumbnail: data.thumbnail_url || null,
          author: data.author_name || '',
          description: data.title || '',
        };
      }
    }

    // ── Generic websites (recipe blogs etc) ──────────────────────────────────
    else {
      metadata = await scrapeOpenGraph(url, 'web');
    }

    if (!metadata) {
      return res.status(422).json({ error: 'Could not extract metadata from this URL' });
    }

    return res.status(200).json(metadata);
  } catch (err) {
    console.error('Metadata fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// Open Graph scraper for generic sites and Instagram fallback
async function scrapeOpenGraph(url, platform) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    if (!response.ok) return null;

    const html = await response.text();

    function getMeta(property) {
      const match =
        html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'));
      return match ? match[1] : null;
    }

    const title =
      getMeta('og:title') ||
      getMeta('twitter:title') ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
      '';

    const description =
      getMeta('og:description') ||
      getMeta('twitter:description') ||
      getMeta('description') ||
      '';

    const thumbnail =
      getMeta('og:image') ||
      getMeta('twitter:image') ||
      null;

    return {
      platform,
      title: title.trim(),
      thumbnail,
      author: getMeta('og:site_name') || '',
      description: description.trim(),
      pageText: html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 8000), // pass first 8k chars of page text to Claude
    };
  } catch {
    return null;
  }
}
