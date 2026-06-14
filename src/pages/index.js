// src/pages/index.js
import { useState, useEffect, useCallback } from 'react';
import { fsGetAll, fsSet, fsUpdate, fsAdd, COL } from '../lib/db';
import { extractRecipeFromMetadata, generateMenu } from '../lib/claude';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function fetchMetadata(url) {
  const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error('Could not fetch metadata for this URL');
  return res.json();
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function Home() {
  return <MainApp />;
}

// ── Main App ──────────────────────────────────────────────────────────────────
function MainApp() {
  const [view, setView] = useState('home'); // home | add | recipe | menu | history | occasion-rate
  const [recipes, setRecipes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menus, setMenus] = useState([]);
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null); // menu pending post-occasion rating
  const [clipUrl, setClipUrl] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [recs, cats, mens] = await Promise.all([
      fsGetAll(COL.RECIPES),
      fsGetAll(COL.CATEGORIES),
      fsGetAll(COL.MENUS),
    ]);
    setRecipes(recs.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0)));
    setCategories(cats);
    setMenus(mens.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    async function check() {
      try {
        const text = await navigator.clipboard.readText();
        if (text?.match(/^https?:\/\//)) setClipUrl(text);
      } catch {}
    }
    window.addEventListener('focus', check);
    check();
    return () => window.removeEventListener('focus', check);
  }, []);

  function goRecipe(r) { setActiveRecipe(r); setView('recipe'); }
  function goHome() { setView('home'); setActiveRecipe(null); setActiveMenu(null); }
  function goOccasionRate(menu) { setActiveMenu(menu); setView('occasion-rate'); }

  return (
    <div style={{ minHeight: '100vh', maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      {view !== 'add' && (
        <header style={{ padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {view !== 'home'
            ? <button onClick={goHome} style={s.ghost}>← Back</button>
            : <span style={s.brand}>Recipe Vault</span>
          }
          {view === 'home' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setView('history')} style={s.pill}>History</button>
              <button onClick={() => setView('menu')} style={s.pill}>Plan Menu</button>
            </div>
          )}
        </header>
      )}

      {/* Clipboard banner */}
      {clipUrl && view === 'home' && (
        <div style={{ margin: '14px 20px 0', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 10, padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 12, color: 'var(--warn-text)', fontWeight: 600, marginBottom: 2 }}>Link detected</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clipUrl}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setView('add')} style={s.btn('sm')}>Add Recipe</button>
            <button onClick={() => setClipUrl('')} style={s.ghost}>✕</button>
          </div>
        </div>
      )}

      <div style={{ padding: '16px 20px 100px' }}>
        {loading
          ? <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 60 }}>Loading...</p>
          : <>
            {view === 'home' && (
              <HomeView
                recipes={recipes}
                categories={categories}
                menus={menus}
                onOpen={goRecipe}
                onAdd={() => setView('add')}
                onRateOccasion={goOccasionRate}
              />
            )}
            {view === 'add' && (
              <AddView
                prefillUrl={clipUrl}
                categories={categories}
                onCancel={goHome}
                onNewCategory={async name => {
                  const id = slugify(name);
                  await fsSet(COL.CATEGORIES, id, { id, name });
                  await reload();
                }}
                onSaved={async () => { setClipUrl(''); await reload(); goHome(); }}
              />
            )}
            {view === 'recipe' && activeRecipe && (
              <RecipeView
                recipe={activeRecipe}
                onRate={async (id, rating) => {
                  const r = recipes.find(x => x.id === id);
                  const ratings = [...(r.ratings || []), { rating, date: new Date().toISOString() }];
                  const avg = ratings.reduce((s, x) => s + x.rating, 0) / ratings.length;
                  await fsUpdate(COL.RECIPES, id, { ratings, avgRating: avg });
                  setActiveRecipe({ ...activeRecipe, ratings, avgRating: avg });
                  await reload();
                }}
              />
            )}
            {view === 'menu' && (
              <MenuView
                recipes={recipes}
                onSaved={async (menuDoc) => {
                  await reload();
                  // Go straight to occasion-rate view for the new menu
                  goOccasionRate(menuDoc);
                }}
              />
            )}
            {view === 'history' && (
              <HistoryView menus={menus} recipes={recipes} onRateOccasion={goOccasionRate} />
            )}
            {view === 'occasion-rate' && activeMenu && (
              <OccasionRateView
                menu={activeMenu}
                recipes={recipes}
                onDone={async (ratings) => {
                  // ratings = [{ recipeName, rating }]
                  // 1. Update the menu doc with post-occasion ratings
                  await fsUpdate(COL.MENUS, activeMenu.id, {
                    occasionRatings: ratings,
                    ratedAt: new Date().toISOString(),
                  });
                  // 2. Update each recipe's avgRating
                  for (const { recipeName, rating } of ratings) {
                    if (!rating) continue;
                    const recipe = recipes.find(r => r.name === recipeName);
                    if (!recipe) continue;
                    const existing = recipe.ratings || [];
                    const updated = [...existing, { rating, date: new Date().toISOString(), occasion: activeMenu.occasion }];
                    const avg = updated.reduce((s, x) => s + x.rating, 0) / updated.length;
                    await fsUpdate(COL.RECIPES, recipe.id, { ratings: updated, avgRating: avg });
                  }
                  await reload();
                  goHome();
                }}
              />
            )}
          </>
        }
      </div>

      {view === 'home' && (
        <button
          onClick={() => setView('add')}
          style={{ position: 'fixed', bottom: 28, right: 24, width: 56, height: 56, borderRadius: 28, background: 'var(--accent)', border: 'none', color: '#fff', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 24px var(--accent-glow)' }}
        >+</button>
      )}
    </div>
  );
}

// ── Home View ─────────────────────────────────────────────────────────────────
function HomeView({ recipes, categories, menus, onOpen, onAdd, onRateOccasion }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Menus that have been used but not yet rated
  const pendingRating = menus.filter(m => m.used && !m.ratedAt);

  const shown = recipes.filter(r => {
    const catOk = filter === 'all' || (r.categories || []).includes(filter);
    const searchOk = !search || r.name?.toLowerCase().includes(search.toLowerCase()) || r.cuisine?.toLowerCase().includes(search.toLowerCase());
    return catOk && searchOk;
  });

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: '8px 0 18px' }}>My Recipes</h1>

      {/* Pending rating nudge */}
      {pendingRating.length > 0 && (
        <div style={{ background: '#0F1F0F', border: '1px solid #14532D', borderRadius: 10, padding: '13px 16px', marginBottom: 18 }}>
          <p style={{ fontSize: 12, color: '#4ADE80', fontWeight: 600, marginBottom: 4 }}>Rate your recent occasion</p>
          {pendingRating.slice(0, 2).map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <p style={{ fontSize: 13, color: 'var(--text2)' }}>{m.menuName} · {m.occasion}</p>
              <button onClick={() => onRateOccasion(m)} style={s.btn('sm')}>Rate</button>
            </div>
          ))}
        </div>
      )}

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipes..." style={{ ...s.input, marginBottom: 14 }} />

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 20 }}>
        {[{ id: 'all', name: 'All' }, ...categories].map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)} style={s.chip(filter === c.id)}>{c.name}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🍽</div>
          <p style={{ color: 'var(--faint)', marginBottom: 20 }}>{search || filter !== 'all' ? 'No matches.' : 'No recipes yet.'}</p>
          {!search && filter === 'all' && <button onClick={onAdd} style={s.btn()}>Add your first recipe</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(r => <RecipeCard key={r.id} recipe={r} onClick={() => onOpen(r)} />)}
        </div>
      )}
    </div>
  );
}

function RecipeCard({ recipe, onClick }) {
  return (
    <div onClick={onClick} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', cursor: 'pointer' }}>
      <div style={{ width: 88, flexShrink: 0, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 88 }}>
        {recipe.thumbnail
          ? <img src={recipe.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
          : <span style={{ fontSize: 28 }}>🍳</span>
        }
      </div>
      <div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{recipe.name}</p>
        {recipe.cuisine && <p style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 5 }}>{recipe.cuisine}</p>}
        <Stars rating={recipe.avgRating} count={(recipe.ratings || []).length} />
        {recipe.timesServed > 0 && <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>Served {recipe.timesServed}×</p>}
      </div>
    </div>
  );
}

// ── Add Recipe ────────────────────────────────────────────────────────────────
function AddView({ prefillUrl, categories, onCancel, onNewCategory, onSaved }) {
  const [url, setUrl] = useState(prefillUrl || '');
  const [step, setStep] = useState('url');
  const [recipe, setRecipe] = useState(null);
  const [selectedCats, setSelectedCats] = useState([]);
  const [newCat, setNewCat] = useState('');
  const [error, setError] = useState('');

  async function handleExtract() {
    if (!url.trim()) return;
    setStep('extracting');
    setError('');
    try {
      const metadata = await fetchMetadata(url.trim());
      const extracted = await extractRecipeFromMetadata(url.trim(), metadata);
      if (!extracted.thumbnail && metadata.thumbnail) extracted.thumbnail = metadata.thumbnail;
      extracted.videoUrl = url.trim();
      extracted.platform = metadata.platform;
      setRecipe(extracted);
      setStep('cats');
    } catch (e) {
      setError(e.message);
      setStep('url');
    }
  }

  async function handleAddCat() {
    if (!newCat.trim()) return;
    await onNewCategory(newCat.trim());
    setNewCat('');
  }

  async function handleSave() {
    setStep('saving');
    try {
      const id = slugify(recipe.name) + '-' + Date.now();
      await fsSet(COL.RECIPES, id, {
        ...recipe,
        id,
        categories: selectedCats,
        createdAt: new Date().toISOString(),
        ratings: [],
        avgRating: null,
        timesServed: 0,
      });
      await onSaved();
    } catch (e) {
      setError(e.message);
      setStep('cats');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Add Recipe</h2>
        <button onClick={onCancel} style={s.ghost}>✕</button>
      </div>

      {step === 'url' && (
        <div>
          <label style={s.fieldLabel}>Recipe URL</label>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>TikTok, Instagram, YouTube, or any recipe website</p>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.tiktok.com/..." style={s.input} />
          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>}
          <button onClick={handleExtract} disabled={!url.trim()} style={{ ...s.btn(), opacity: url.trim() ? 1 : 0.45 }}>Extract Recipe</button>
        </div>
      )}

      {step === 'extracting' && (
        <div style={{ textAlign: 'center', marginTop: 80 }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>⏳</div>
          <p style={{ color: 'var(--muted)' }}>Fetching and analyzing recipe...</p>
        </div>
      )}

      {(step === 'cats' || step === 'saving') && recipe && (
        <div>
          {recipe.confidence === 'low' && (
            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--warn-text)' }}>
              ⚠ {recipe.note || 'Low confidence — verify before cooking.'}
            </div>
          )}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
            {recipe.thumbnail && <img src={recipe.thumbnail} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />}
            <div style={{ padding: 16 }}>
              <p style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{recipe.name}</p>
              {recipe.description && <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>{recipe.description}</p>}
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--faint)' }}>
                {recipe.prepTime && <span>Prep {recipe.prepTime}</span>}
                {recipe.cookTime && <span>Cook {recipe.cookTime}</span>}
                {recipe.servings && <span>{recipe.servings}</span>}
              </div>
            </div>
          </div>

          <label style={s.fieldLabel}>Categories</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, marginTop: 6 }}>
            {categories.map(c => (
              <button key={c.id} onClick={() => setSelectedCats(cs => cs.includes(c.id) ? cs.filter(x => x !== c.id) : [...cs, c.id])} style={s.chip(selectedCats.includes(c.id))}>{c.name}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCat()} placeholder="New category..." style={{ ...s.input, flex: 1 }} />
            <button onClick={handleAddCat} style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text2)', borderRadius: 8, padding: '0 16px', fontSize: 14 }}>Add</button>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</p>}
          <button onClick={handleSave} disabled={step === 'saving'} style={{ ...s.btn(), opacity: step === 'saving' ? 0.6 : 1 }}>
            {step === 'saving' ? 'Saving...' : 'Save Recipe'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Recipe Detail ─────────────────────────────────────────────────────────────
function RecipeView({ recipe, onRate }) {
  const [hover, setHover] = useState(0);
  const [rated, setRated] = useState(false);

  async function rate(n) { await onRate(recipe.id, n); setRated(true); }

  return (
    <div>
      {recipe.thumbnail && (
        <a href={recipe.videoUrl} target="_blank" rel="noreferrer" style={{ display: 'block', position: 'relative', marginBottom: 20, borderRadius: 12, overflow: 'hidden' }}>
          <img src={recipe.thumbnail} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, paddingLeft: 3 }}>▶</div>
          </div>
        </a>
      )}

      {recipe.cuisine && <p style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 4 }}>{recipe.cuisine}</p>}
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>{recipe.name}</h1>
      {recipe.description && <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16, lineHeight: 1.65 }}>{recipe.description}</p>}

      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--faint)', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {recipe.prepTime && <span>Prep {recipe.prepTime}</span>}
        {recipe.cookTime && <span>Cook {recipe.cookTime}</span>}
        {recipe.servings && <span>{recipe.servings}</span>}
        {recipe.timesServed > 0 && <span>Served {recipe.timesServed}×</span>}
      </div>

      <Section title="Ingredients">
        {(recipe.ingredients || []).map((ing, i) => (
          <div key={i} style={{ padding: '9px 0', borderBottom: i < recipe.ingredients.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 14, color: 'var(--text2)', display: 'flex', gap: 10 }}>
            <span style={{ color: 'var(--accent)', flexShrink: 0 }}>·</span><span>{ing}</span>
          </div>
        ))}
      </Section>

      <Section title="Instructions">
        {(recipe.instructions || []).map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 26, height: 26, borderRadius: 13, background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
            <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.65 }}>{step}</p>
          </div>
        ))}
      </Section>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginTop: 8 }}>
        <p style={{ fontWeight: 600, marginBottom: 6 }}>Rate this recipe</p>
        {recipe.avgRating && <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>Avg {recipe.avgRating.toFixed(1)} ★ · {(recipe.ratings || []).length} rating{recipe.ratings.length !== 1 ? 's' : ''}</p>}
        {rated
          ? <p style={{ color: 'var(--green)', fontSize: 14 }}>Rating saved.</p>
          : (
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => rate(n)}
                  style={{ background: 'none', border: 'none', fontSize: 36, color: n <= hover ? 'var(--gold)' : 'var(--faint)', padding: 0, lineHeight: 1 }}>★</button>
              ))}
            </div>
          )
        }
      </div>

      {!recipe.thumbnail && recipe.videoUrl && (
        <a href={recipe.videoUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 20, color: 'var(--accent)', fontSize: 14, textAlign: 'center' }}>Open original video ↗</a>
      )}
    </div>
  );
}

// ── Menu View ─────────────────────────────────────────────────────────────────
function MenuView({ recipes, onSaved }) {
  const [occasion, setOccasion] = useState('');
  const [adults, setAdults] = useState('4');
  const [kids, setKids] = useState('0');
  const [style, setStyle] = useState('casual');
  const [menu, setMenu] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');
  const styles = ['casual', 'formal', 'modern', 'rustic', 'festive', 'intimate'];

  async function generate() {
    setLoading(true); setError('');
    try {
      const m = await generateMenu(recipes, occasion, parseInt(adults), parseInt(kids), style);
      // Save to rv_menus immediately
      const id = await fsAdd(COL.MENUS, {
        ...m,
        occasion,
        adults: parseInt(adults),
        kids: parseInt(kids),
        style,
        createdAt: new Date().toISOString(),
        used: false,
        ratedAt: null,
        occasionRatings: [],
      });
      setMenuId(id);
      setMenu({ ...m, id, occasion, adults, kids, style });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function markUsed() {
    setMarking(true);
    await fsUpdate(COL.MENUS, menuId, { used: true });
    // Increment timesServed for each recipe in this menu
    for (const course of menu.courses || []) {
      const recipe = recipes.find(r => r.name === course.recipeName);
      if (recipe) {
        await fsUpdate(COL.RECIPES, recipe.id, { timesServed: (recipe.timesServed || 0) + 1 });
      }
    }
    await onSaved({ ...menu, id: menuId, used: true });
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Plan a Menu</h2>
      {!menu ? (
        <div>
          <Field label="Occasion"><input value={occasion} onChange={e => setOccasion(e.target.value)} placeholder="Saturday dinner, Birthday..." style={s.input} /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Adults" style={{ flex: 1 }}><input type="number" min="0" value={adults} onChange={e => setAdults(e.target.value)} style={s.input} /></Field>
            <Field label="Kids" style={{ flex: 1 }}><input type="number" min="0" value={kids} onChange={e => setKids(e.target.value)} style={s.input} /></Field>
          </div>
          <Field label="Style">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {styles.map(st => <button key={st} onClick={() => setStyle(st)} style={{ ...s.chip(style === st), textTransform: 'capitalize' }}>{st}</button>)}
            </div>
          </Field>
          {recipes.length === 0 && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>Add recipes first.</p>}
          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</p>}
          <button onClick={generate} disabled={loading || !occasion.trim() || recipes.length === 0}
            style={{ ...s.btn(), opacity: loading || !occasion.trim() || recipes.length === 0 ? 0.45 : 1 }}>
            {loading ? 'Generating...' : 'Generate Menu'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Menu for {menu.occasion}</p>
            <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{menu.menuName}</p>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>{menu.theme}</p>
            <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6 }}>{menu.adults} adults · {menu.kids} kids · {menu.style}</p>
          </div>

          {(menu.courses || []).map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
              <p style={{ fontSize: 10, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em', width: 56, flexShrink: 0, paddingTop: 3 }}>{c.course}</p>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{c.recipeName}</p>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>{c.reason}</p>
              </div>
            </div>
          ))}

          {menu.notes && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Notes</p>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>{menu.notes}</p>
            </div>
          )}
          {menu.shoppingTips && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
              <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Shopping</p>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>{menu.shoppingTips}</p>
            </div>
          )}

          <button onClick={markUsed} disabled={marking} style={{ ...s.btn(), marginBottom: 10, opacity: marking ? 0.6 : 1 }}>
            {marking ? 'Saving...' : '✓ We used this menu — rate it'}
          </button>
          <button onClick={() => { setMenu(null); setMenuId(null); }} style={s.btn('ghost')}>Generate another</button>
        </div>
      )}
    </div>
  );
}

// ── Occasion Rating View ──────────────────────────────────────────────────────
function OccasionRateView({ menu, recipes, onDone }) {
  const servedRecipes = (menu.courses || []).map(c => c.recipeName);
  const [ratings, setRatings] = useState(
    servedRecipes.reduce((acc, name) => ({ ...acc, [name]: 0 }), {})
  );
  const [hover, setHover] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const ratingsList = servedRecipes.map(name => ({ recipeName: name, rating: ratings[name] || 0 }));
    await onDone(ratingsList);
  }

  return (
    <div>
      <p style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Post-Occasion Rating</p>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{menu.menuName}</h2>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>How did each recipe go? Ratings will improve future menu suggestions.</p>

      {servedRecipes.map(name => {
        const recipe = recipes.find(r => r.name === name);
        return (
          <div key={name} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 12, display: 'flex', gap: 14, alignItems: 'center' }}>
            {recipe?.thumbnail && (
              <img src={recipe.thumbnail} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} onError={e => e.target.style.display = 'none'} />
            )}
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{name}</p>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n}
                    onMouseEnter={() => setHover(h => ({ ...h, [name]: n }))}
                    onMouseLeave={() => setHover(h => ({ ...h, [name]: 0 }))}
                    onClick={() => setRatings(r => ({ ...r, [name]: n }))}
                    style={{ background: 'none', border: 'none', fontSize: 28, padding: 0, lineHeight: 1,
                      color: n <= (hover[name] || ratings[name]) ? 'var(--gold)' : 'var(--faint)' }}>★</button>
                ))}
                {ratings[name] === 0 && <span style={{ fontSize: 12, color: 'var(--faint)', marginLeft: 6, alignSelf: 'center' }}>skip</span>}
              </div>
            </div>
          </div>
        );
      })}

      <button onClick={submit} disabled={saving} style={{ ...s.btn(), marginTop: 8, opacity: saving ? 0.6 : 1 }}>
        {saving ? 'Saving...' : 'Save Ratings'}
      </button>
    </div>
  );
}

// ── History View ──────────────────────────────────────────────────────────────
function HistoryView({ menus, recipes, onRateOccasion }) {
  const used = menus.filter(m => m.used);

  if (used.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Menu History</h2>
        <p style={{ color: 'var(--faint)', textAlign: 'center', marginTop: 60 }}>No past menus yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Menu History</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {used.map(m => (
          <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15 }}>{m.menuName}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.occasion} · {new Date(m.createdAt).toLocaleDateString()}</p>
              </div>
              {!m.ratedAt && (
                <button onClick={() => onRateOccasion(m)} style={s.btn('sm')}>Rate</button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(m.courses || []).map((c, i) => (
                <span key={i} style={{ fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 6, padding: '3px 8px', color: 'var(--text2)' }}>{c.recipeName}</span>
              ))}
            </div>
            {m.ratedAt && (
              <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 8 }}>✓ Rated</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 12, fontWeight: 600 }}>{title}</p>
      {children}
    </div>
  );
}

function Field({ label, children, style: extra }) {
  return (
    <div style={{ marginBottom: 16, ...extra }}>
      <label style={s.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

function Stars({ rating, count }) {
  if (!rating) return <p style={{ fontSize: 11, color: 'var(--faint)' }}>No ratings yet</p>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {[1,2,3,4,5].map(i => <span key={i} style={{ fontSize: 12, color: i <= rating ? 'var(--gold)' : 'var(--faint)' }}>★</span>)}
      {count > 0 && <span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 4 }}>({count})</span>}
    </div>
  );
}

const s = {
  brand: { fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700 },
  fieldLabel: { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 },
  ghost: { background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, padding: 0, cursor: 'pointer' },
  pill: { background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text2)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', padding: '12px 14px', fontSize: 15, display: 'block' },
  chip: (active) => ({
    flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--muted)',
    border: active ? 'none' : '1px solid var(--border2)',
    whiteSpace: 'nowrap',
  }),
  btn: (variant) => {
    if (variant === 'ghost') return { marginTop: 4, width: '100%', padding: '13px 24px', background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' };
    if (variant === 'sm') return { padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 };
    return { marginTop: 16, width: '100%', padding: '13px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' };
  },
};
