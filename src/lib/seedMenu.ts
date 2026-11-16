import type { MenuItem, HydratedSauce } from '@/types/database';

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ============================================================
// SVG-фото с эмодзи (offline, ~500 байт каждое)
// ============================================================
function svgPhoto(
  emoji: string,
  color1: string,
  color2: string
): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='100' height='100'>` +
    `<defs>` +
    `<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${color1}'/>` +
    `<stop offset='1' stop-color='${color2}'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width='100' height='100' fill='url(#g)'/>` +
    `<text x='50' y='72' font-size='56' text-anchor='middle' fill='white' ` +
    `font-family='system-ui,Segoe UI,Apple Color Emoji,sans-serif'>${emoji}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Палитры градиентов
const GRAD = {
  kebabChicken: ['#fb923c', '#ea580c'] as const,
  kebabMix: ['#f97316', '#dc2626'] as const,
  kebabBeef: ['#b45309', '#7c2d12'] as const,
  wrapChicken: ['#facc15', '#ca8a04'] as const,
  wrapMix: ['#f59e0b', '#b45309'] as const,
  wrapBeef: ['#a16207', '#451a03'] as const,
  don: ['#ef4444', '#991b1b'] as const,
  otsumami: ['#dc2626', '#7c2d12'] as const,
  fries: ['#fde047', '#f59e0b'] as const,
  setSandwich: ['#8b5cf6', '#6d28d9'] as const,
  setWrap: ['#6366f1', '#4338ca'] as const,
  cola: ['#dc2626', '#7f1d1d'] as const,
  pepsi: ['#2563eb', '#1e40af'] as const,
  sprite: ['#22c55e', '#15803d'] as const,
  fanta: ['#f97316', '#c2410c'] as const,
  water: ['#38bdf8', '#0284c7'] as const,
  ayran: ['#e0f2fe', '#7dd3fc'] as const,
  sauceMild: ['#4ade80', '#16a34a'] as const,
  sauceMix: ['#fb923c', '#c2410c'] as const,
  sauceSpicy: ['#f87171', '#b91c1c'] as const,
  sauceGarlic: ['#e5e7eb', '#94a3b8'] as const,
  sauceTeriyaki: ['#a16207', '#713f12'] as const,
  cheese: ['#fde047', '#ca8a04'] as const,
  jalapeno: ['#22c55e', '#166534'] as const,
  mushroom: ['#a78bfa', '#6d28d9'] as const,
  friesTop: ['#fbbf24', '#d97706'] as const,
};

// ============================================================
// ТЕСТОВОЕ МЕНЮ
// ============================================================
export function buildTestMenu(): MenuItem[] {
  const now = new Date().toISOString();

  // ------------------------------------------------------------
  // СОСУСЫ
  // ------------------------------------------------------------
  const sauceDefs = [
    {
      name: 'Mild',
      color: '#22c55e',
      image: svgPhoto('🥣', ...GRAD.sauceMild),
    },
    {
      name: 'Mix',
      color: '#f97316',
      image: svgPhoto('🥣', ...GRAD.sauceMix),
    },
    {
      name: 'Spicy',
      color: '#ef4444',
      image: svgPhoto('🌶️', ...GRAD.sauceSpicy),
    },
    {
      name: 'Garlic Yogurt',
      color: '#e5e7eb',
      image: svgPhoto('🥣', ...GRAD.sauceGarlic),
    },
    {
      name: 'Teriyaki',
      color: '#a16207',
      image: svgPhoto('🥣', ...GRAD.sauceTeriyaki),
    },
  ];

  const sauces: MenuItem[] = sauceDefs.map((s, i) => ({
    id: uid(),
    type: 'sauce',
    name: s.name,
    short_name: s.name,
    image_url: s.image,
    price: 0,
    free: true,
    station: null,
    cook_time_min: null,
    color: s.color,
    dish_kind: null,
    sauce_mode: null,
    parent_id: null,
    active: true,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }));

  const sauceHydrated: HydratedSauce[] = sauces.map((s) => ({
    id: s.id,
    name: s.name,
    short_name: s.short_name,
    image_url: s.image_url,
    price: s.price,
    free: s.free,
    color: s.color,
    active: s.active,
  }));

  // ------------------------------------------------------------
  // НАПИТКИ
  // ------------------------------------------------------------
  const drinkDefs = [
    { name: 'Coca-Cola', price: 150, image: svgPhoto('🥤', ...GRAD.cola) },
    { name: 'Pepsi', price: 150, image: svgPhoto('🥤', ...GRAD.pepsi) },
    { name: 'Sprite', price: 150, image: svgPhoto('🥤', ...GRAD.sprite) },
    { name: 'Fanta', price: 150, image: svgPhoto('🥤', ...GRAD.fanta) },
    { name: 'Вода', price: 100, image: svgPhoto('💧', ...GRAD.water) },
    { name: 'Айран', price: 200, image: svgPhoto('🥛', ...GRAD.ayran) },
  ];

  const drinks: MenuItem[] = drinkDefs.map((d, i) => ({
    id: uid(),
    type: 'drink',
    name: d.name,
    short_name: d.name,
    image_url: d.image,
    price: d.price,
    free: false,
    station: null,
    cook_time_min: null,
    color: null,
    dish_kind: null,
    sauce_mode: null,
    parent_id: null,
    active: true,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }));

  // ------------------------------------------------------------
  // ТОППИНГИ
  // ------------------------------------------------------------
  const toppingDefs = [
    { name: 'Cheese', price: 150, image: svgPhoto('🧀', ...GRAD.cheese) },
    { name: 'Jalapeño', price: 150, image: svgPhoto('🌶️', ...GRAD.jalapeno) },
    { name: 'Mushrooms', price: 150, image: svgPhoto('🍄', ...GRAD.mushroom) },
    {
      name: 'French Fries',
      price: 150,
      image: svgPhoto('🍟', ...GRAD.friesTop),
    },
  ];

  const toppings: MenuItem[] = toppingDefs.map((t, i) => ({
    id: uid(),
    type: 'topping',
    name: t.name,
    short_name: t.name,
    image_url: t.image,
    price: t.price,
    free: false,
    station: 'ready',
    cook_time_min: null,
    color: null,
    dish_kind: null,
    sauce_mode: null,
    parent_id: null,
    active: true,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }));

  // ------------------------------------------------------------
  // БЛЮДА — помощники
  // ------------------------------------------------------------
  function makeVariant(
    parentId: string,
    name: string,
    price: number,
    imageUrl: string,
    sortOrder: number
  ): MenuItem {
    return {
      id: uid(),
      type: 'dish',
      name,
      short_name: name,
      image_url: imageUrl,
      price,
      free: false,
      station: 'kitchen',
      cook_time_min: 10,
      color: null,
      dish_kind: 'single',
      sauce_mode: 'with',
      parent_id: parentId,
      active: true,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      properties: [],
      allowed_sauces: sauceHydrated,
    };
  }

  function makeDishGroup(
    name: string,
    shortName: string,
    coverImage: string,
    variants: Array<{ name: string; price: number; image: string }>,
    sortOrder: number
  ): MenuItem {
    const groupId = uid();
    return {
      id: groupId,
      type: 'dish',
      name,
      short_name: shortName,
      image_url: coverImage,
      price: 0,
      free: false,
      station: null,
      cook_time_min: null,
      color: null,
      dish_kind: 'group',
      sauce_mode: null,
      parent_id: null,
      active: true,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      variants: variants.map((v, i) =>
        makeVariant(groupId, v.name, v.price, v.image, i)
      ),
      properties: [],
    };
  }

  // ------------------------------------------------------------
  // БЛЮДА — данные
  // ------------------------------------------------------------
  const kebabSandwich = makeDishGroup(
    'Kebab Sandwich',
    'KS',
    svgPhoto('🥙', ...GRAD.kebabMix),
    [
      {
        name: 'Chicken',
        price: 350,
        image: svgPhoto('🥙', ...GRAD.kebabChicken),
      },
      { name: 'Mix', price: 500, image: svgPhoto('🥙', ...GRAD.kebabMix) },
      { name: 'Beef', price: 650, image: svgPhoto('🥙', ...GRAD.kebabBeef) },
    ],
    0
  );

  const kebabWrap = makeDishGroup(
    'Kebab Wrap',
    'KW',
    svgPhoto('🌯', ...GRAD.wrapMix),
    [
      {
        name: 'Chicken',
        price: 500,
        image: svgPhoto('🌯', ...GRAD.wrapChicken),
      },
      { name: 'Mix', price: 650, image: svgPhoto('🌯', ...GRAD.wrapMix) },
      { name: 'Beef', price: 800, image: svgPhoto('🌯', ...GRAD.wrapBeef) },
    ],
    1
  );

  const kebabDon: MenuItem = {
    id: uid(),
    type: 'dish',
    name: 'Kebab Don',
    short_name: 'KD',
    image_url: svgPhoto('🍚', ...GRAD.don),
    price: 650,
    free: false,
    station: 'kitchen',
    cook_time_min: 12,
    color: null,
    dish_kind: 'single',
    sauce_mode: 'with',
    parent_id: null,
    active: true,
    sort_order: 2,
    created_at: now,
    updated_at: now,
    properties: [],
    allowed_sauces: sauceHydrated,
  };

  const otsumami: MenuItem = {
    id: uid(),
    type: 'dish',
    name: 'Otsumami Kebab',
    short_name: 'OK',
    image_url: svgPhoto('🍢', ...GRAD.otsumami),
    price: 500,
    free: false,
    station: 'kitchen',
    cook_time_min: 8,
    color: null,
    dish_kind: 'single',
    sauce_mode: 'with',
    parent_id: null,
    active: true,
    sort_order: 3,
    created_at: now,
    updated_at: now,
    properties: [],
    allowed_sauces: sauceHydrated,
  };

  const frenchFries: MenuItem = {
    id: uid(),
    type: 'dish',
    name: 'French Fries',
    short_name: 'FF',
    image_url: svgPhoto('🍟', ...GRAD.fries),
    price: 450,
    free: false,
    station: 'kitchen',
    cook_time_min: 8,
    color: null,
    dish_kind: 'single',
    sauce_mode: 'none',
    parent_id: null,
    active: true,
    sort_order: 4,
    created_at: now,
    updated_at: now,
    properties: [],
    allowed_sauces: [],
  };

  // ------------------------------------------------------------
  // СЕТЫ
  // ------------------------------------------------------------
  function makeSet(
    name: string,
    shortName: string,
    coverImage: string,
    mainDish: MenuItem,
    sortOrder: number
  ): MenuItem {
    const setId = uid();
    const setMain = JSON.parse(JSON.stringify(mainDish)) as MenuItem;

    return {
      id: setId,
      type: 'set',
      name,
      short_name: shortName,
      image_url: coverImage,
      price: 0,
      free: false,
      station: null,
      cook_time_min: null,
      color: null,
      dish_kind: null,
      sauce_mode: null,
      parent_id: null,
      active: true,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      set_main: setMain,
      set_extra_groups: [
        {
          id: uid(),
          set_item_id: setId,
          label: 'Напиток',
          required: true,
          sort_order: 0,
          options: drinks.map((d) => ({
            option_id: uid(),
            item: JSON.parse(JSON.stringify(d)) as MenuItem,
          })),
        },
        {
          id: uid(),
          set_item_id: setId,
          label: 'Соус',
          required: true,
          sort_order: 1,
          options: sauces.map((s) => ({
            option_id: uid(),
            item: JSON.parse(JSON.stringify(s)) as MenuItem,
          })),
        },
      ],
    };
  }

  const setKS = makeSet(
    'Kebab Sandwich Set',
    'KSS',
    svgPhoto('🥙', ...GRAD.setSandwich),
    kebabSandwich,
    5
  );

  const setKW = makeSet(
    'Kebab Wrap Set',
    'KWS',
    svgPhoto('🌯', ...GRAD.setWrap),
    kebabWrap,
    6
  );

  // ------------------------------------------------------------
  // СБОРКА
  // ------------------------------------------------------------
  return [
    // dishset
    kebabSandwich,
    kebabWrap,
    kebabDon,
    otsumami,
    frenchFries,
    setKS,
    setKW,
    // напитки
    ...drinks,
    // соусы
    ...sauces,
    // топпинги
    ...toppings,
  ];
}
