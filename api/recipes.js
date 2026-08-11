const aliases = {
  arroz: ['rice'], tomate: ['tomato'], pollo: ['chicken'], papa: ['potato'],
  banana: ['banana'], leche: ['milk'], avena: ['oat', 'oats', 'oatmeal'],
  harina: ['flour'], pan: ['bread'], queso: ['cheese'], huevo: ['egg', 'eggs'],
  fideos: ['pasta', 'spaghetti', 'noodles'], pasta: ['pasta'], lenteja: ['lentil', 'lentils'],
  atun: ['tuna'], carne: ['beef'], jamon: ['ham'], yogur: ['yogurt', 'yoghurt'],
  cacao: ['cocoa'], cebolla: ['onion'], zanahoria: ['carrot'], morron: ['pepper'],
  verdura: ['vegetable', 'vegetables']
};

const normalize = (value = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const words = (value) => normalize(value).split(/\s+/).filter(Boolean);

function ingredientTerms(label) {
  const text = normalize(label);
  const alias = Object.keys(aliases).find(key => text.includes(key));
  return alias ? aliases[alias] : words(label).slice(0, 1);
}

function hasTerm(ingredient, terms) {
  const text = normalize(ingredient);
  return terms.some(term => text.includes(term) || term.includes(text));
}

function isPeriod(recipe, period) {
  const types = (recipe.dishTypes || []).map(normalize);
  if (!types.length) return true;
  if (period === 'Mañana') return types.some(type => /breakfast|brunch/.test(type));
  if (period === 'Tarde') return types.some(type => /snack|dessert|breakfast/.test(type));
  if (period === 'Mediodía') return types.some(type => /lunch|main course/.test(type));
  return types.some(type => /dinner|main course/.test(type));
}

async function spoonacularSearch(ingredients, apiKey) {
  const params = new URLSearchParams({
    apiKey,
    includeIngredients: ingredients.join(','),
    addRecipeInformation: 'true',
    fillIngredients: 'true',
    number: '100',
    ranking: '2'
  });
  const response = await fetch(`https://api.spoonacular.com/recipes/complexSearch?${params}`);
  if (!response.ok) throw new Error(`Spoonacular respondió ${response.status}`);
  const data = await response.json();
  return data.results || [];
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Método no permitido' });
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) return response.status(500).json({ error: 'Falta configurar SPOONACULAR_API_KEY en el servidor.' });

  const selected = String(request.query.ingredients || '').split('|').map(value => value.trim()).filter(Boolean);
  const period = String(request.query.period || 'Mediodía');
  if (!selected.length) return response.status(400).json({ error: 'Seleccioná al menos un alimento.' });

  try {
    const canonical = selected.map(ingredientTerms);
    const queryTerms = canonical.map(terms => terms[0]).filter(Boolean);
    const candidates = await spoonacularSearch(queryTerms, apiKey);
    const seen = new Set();
    const verified = candidates
      .filter(recipe => !seen.has(recipe.id) && seen.add(recipe.id))
      .filter(recipe => canonical.every(terms => (recipe.extendedIngredients || []).some(item => hasTerm(item.originalName || item.name || '', terms))))
      .filter(recipe => isPeriod(recipe, period))
      .slice(0, 10)
      .map(recipe => ({
        id: recipe.id,
        title: recipe.title,
        ingredients: (recipe.extendedIngredients || []).map(item => ({
          name: item.originalName || item.name,
          amount: Number(item.amount) || null,
          unit: item.unit || '',
          original: item.original || item.name
        })),
        instructions: recipe.instructions || recipe.summary || 'Ver receta original para la preparación completa.',
        readyInMinutes: recipe.readyInMinutes || null,
        servings: recipe.servings || null,
        sourceUrl: recipe.sourceUrl || recipe.spoonacularSourceUrl || null
      }));
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return response.status(200).json({ recipes: verified });
  } catch (error) {
    return response.status(502).json({ error: 'No se pudo consultar la fuente de recetas.', detail: error.message });
  }
}
