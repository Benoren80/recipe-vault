// src/lib/claude.js

export async function claudeCall(system, userMsg, maxTokens = 1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.find(b => b.type === 'text')?.text || '';
}

export async function extractRecipeFromMetadata(url, metadata) {
  const system = `You are a recipe extraction engine. Given metadata fetched from a social media or recipe URL, extract the full recipe. Return ONLY valid JSON — no markdown, no explanation, no code fences.`;

  const context = `
URL: ${url}
Platform: ${metadata.platform}
Title/Caption: ${metadata.title}
Description: ${metadata.description}
Author: ${metadata.author}
${metadata.pageText ? `Page text (first 6000 chars):\n${metadata.pageText.slice(0, 6000)}` : ''}
`.trim();

  const userMsg = `${context}

Extract the recipe and return this exact JSON:
{
  "name": "Recipe name",
  "description": "1-2 sentence description",
  "ingredients": ["100g pasta", "2 cloves garlic"],
  "instructions": ["Boil water", "Cook pasta for 8 minutes"],
  "servings": "4 people",
  "prepTime": "10 mins",
  "cookTime": "20 mins",
  "cuisine": "Italian",
  "confidence": "high|medium|low",
  "note": "caveat if confidence is not high, else null"
}

If the page text contains a full recipe, extract it precisely. If only a social media caption is available, use it plus culinary knowledge to fill in likely details and set confidence to "low".`;

  const raw = await claudeCall(system, userMsg, 2000);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

export async function generateMenu(recipes, occasion, adults, kids, style) {
  const recipeList = recipes
    .map(r => `- ${r.name} (avg rating: ${r.avgRating ? r.avgRating.toFixed(1) + '/5' : 'unrated'}, cuisine: ${r.cuisine || 'misc'}, categories: ${(r.categories || []).join(', ')})`)
    .join('\n');

  const system = `You are a menu planner. Return ONLY valid JSON.`;
  const userMsg = `Plan a menu for:
Occasion: ${occasion}
Guests: ${adults} adults, ${kids} kids
Style: ${style}

Available recipes (sorted by rating):
${recipeList}

Prioritize recipes with higher ratings. Return:
{
  "menuName": "name",
  "theme": "one-line theme",
  "courses": [
    { "course": "Starter|Main|Side|Dessert|Drink", "recipeName": "exact name", "reason": "why it fits" }
  ],
  "notes": "prep or serving notes",
  "shoppingTips": "any bulk shopping note"
}`;

  const raw = await claudeCall(system, userMsg, 1500);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}
