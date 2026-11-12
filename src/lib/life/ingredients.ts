// Ingredients the recipes use, with nutrition per 100 g (or 100 ml), the pack you
// would buy at Sainsbury's and what each one contains.
//
// Nutrition comes from McCance and Widdowson's Composition of Foods Integrated
// Dataset 2021 (CoFID, Public Health England, Open Government Licence) wherever it
// has the food, cited by food code. Foods it lacks use typical UK label values and
// say so. Prices are rough estimates for a first shopping list; the price you set
// when you pick a product replaces them.
//
// `contains` is what the food always has. `watch` is what some brands add, so the
// label needs a look before a product is trusted (soya flour in bread, pea protein
// in protein blends, tamarind in Worcestershire sauce). Pure data, no I/O.

import type { Tag, Watch } from "./allergens.ts";

export type Unit = "g" | "ml" | "each";
export type Aisle =
  | "Meat & fish"
  | "Dairy"
  | "Fruit & veg"
  | "Bakery"
  | "Pasta, rice & grains"
  | "Tins & jars"
  | "Sauces & oils"
  | "Herbs & spices"
  | "Baking"
  | "Frozen"
  | "Supplements";
export type Storage = "fridge" | "freezer" | "cupboard";
/** Per 100 g, or per 100 ml for liquids. */
export type Macros = { kcal: number; protein: number; fat: number; carbs: number };

export type Ingredient = {
  key: string;
  name: string;
  aisle: Aisle;
  per100: Macros;
  /** "CoFID 18-290" or "Typical label". */
  source: string;
  /** How recipes count it. */
  unit: Unit;
  /** Grams in one, for things counted in "each". */
  each?: number;
  /** What you buy, and a rough price in pence. */
  pack: { qty: number; unit: Unit; pence: number };
  storage: Storage;
  /** Days a fresh pack keeps once home, for "use soon" warnings. */
  keeps?: number;
  /** Kept in the cupboard and tracked as have / low / out, not by the gram. */
  staple?: boolean;
  /** Words for Sainsbury's search. */
  search: string;
  contains?: Tag[];
  /** Some brands add these. "egg:baked" means it is there baked in. */
  watch?: Watch[];
  /** Strong flavours some people dislike, for the dislikes filter. */
  traits?: ("strong" | "spicy")[];
};

const cofid = (code: string) => `CoFID ${code}`;
const LABEL = "Typical label";
const m = (kcal: number, protein: number, fat: number, carbs: number): Macros => ({ kcal, protein, fat, carbs });

const LIST: Ingredient[] = [
  // Meat & fish
  { key: "chicken-thigh", name: "Chicken thigh fillets", aisle: "Meat & fish", per100: m(143, 19.5, 7.2, 0), source: cofid("18-299"), unit: "g", pack: { qty: 1000, unit: "g", pence: 695 }, storage: "fridge", keeps: 3, search: "british chicken thigh fillets 1kg" },
  { key: "chicken-breast", name: "Chicken breast fillets", aisle: "Meat & fish", per100: m(106, 24.0, 1.1, 0), source: cofid("18-290"), unit: "g", pack: { qty: 650, unit: "g", pence: 525 }, storage: "fridge", keeps: 3, search: "british chicken breast fillets" },
  { key: "chicken-whole", name: "Whole chicken", aisle: "Meat & fish", per100: m(131, 12.4, 9.0, 0), source: cofid("18-298") + " (weighed with bone)", unit: "g", pack: { qty: 1600, unit: "g", pence: 475 }, storage: "fridge", keeps: 3, search: "british whole chicken" },
  { key: "beef-mince-lean", name: "Beef mince 5% fat", aisle: "Meat & fish", per100: m(130, 21.9, 4.2, 0), source: cofid("18-508"), unit: "g", pack: { qty: 500, unit: "g", pence: 425 }, storage: "fridge", keeps: 2, search: "beef mince 5% fat 500g" },
  { key: "beef-mince", name: "Beef mince 15% fat", aisle: "Meat & fish", per100: m(225, 19.7, 16.2, 0), source: cofid("18-469"), unit: "g", pack: { qty: 500, unit: "g", pence: 325 }, storage: "fridge", keeps: 2, search: "beef mince 15% fat 500g" },
  { key: "beef-strips", name: "Beef stir-fry strips", aisle: "Meat & fish", per100: m(125, 22.0, 4.1, 0), source: cofid("18-043"), unit: "g", pack: { qty: 400, unit: "g", pence: 450 }, storage: "fridge", keeps: 2, search: "beef stir fry strips" },
  { key: "beef-steak", name: "Rump steak", aisle: "Meat & fish", per100: m(174, 20.7, 10.1, 0), source: cofid("18-471"), unit: "g", pack: { qty: 450, unit: "g", pence: 700 }, storage: "fridge", keeps: 3, search: "rump steak" },
  { key: "lamb-mince", name: "Lamb mince", aisle: "Meat & fish", per100: m(196, 19.1, 13.3, 0), source: cofid("18-481"), unit: "g", pack: { qty: 500, unit: "g", pence: 525 }, storage: "fridge", keeps: 2, search: "lamb mince 500g" },
  { key: "pork-shoulder", name: "Pork shoulder steaks", aisle: "Meat & fish", per100: m(168, 18.7, 10.4, 0), source: cofid("18-554"), unit: "g", pack: { qty: 600, unit: "g", pence: 400 }, storage: "fridge", keeps: 3, search: "pork shoulder steaks" },
  { key: "pork-mince", name: "Pork mince", aisle: "Meat & fish", per100: m(164, 19.2, 9.7, 0), source: cofid("18-606"), unit: "g", pack: { qty: 500, unit: "g", pence: 300 }, storage: "fridge", keeps: 2, search: "pork mince 500g" },
  { key: "pork-sausages", name: "Pork sausages", aisle: "Meat & fish", per100: m(309, 11.9, 25.0, 9.6), source: cofid("19-510"), unit: "each", each: 67, pack: { qty: 6, unit: "each", pence: 275 }, storage: "fridge", keeps: 4, search: "pork sausages 6 pack", contains: ["gluten"], watch: ["soy", "pea", "bean"] },
  { key: "chorizo", name: "Cooking chorizo", aisle: "Meat & fish", per100: m(395, 24.0, 32.2, 2.4), source: cofid("19-516"), unit: "g", pack: { qty: 225, unit: "g", pence: 250 }, storage: "fridge", keeps: 14, search: "cooking chorizo", traits: ["spicy"], watch: ["soy"] },
  { key: "ham", name: "Honey roast ham slices", aisle: "Meat & fish", per100: m(107, 18.4, 3.3, 1.0), source: cofid("19-496"), unit: "g", pack: { qty: 200, unit: "g", pence: 200 }, storage: "fridge", keeps: 3, search: "honey roast ham slices", watch: ["soy"] },
  { key: "salmon", name: "Salmon fillets", aisle: "Meat & fish", per100: m(217, 20.4, 15.0, 0), source: cofid("16-356"), unit: "g", pack: { qty: 240, unit: "g", pence: 450 }, storage: "fridge", keeps: 2, search: "salmon fillets skin on 2 pack", contains: ["fish"] },

  // Dairy and eggs
  { key: "milk", name: "Whole milk", aisle: "Dairy", per100: m(63, 3.4, 3.6, 4.6), source: cofid("12-596"), unit: "ml", pack: { qty: 2272, unit: "ml", pence: 165 }, storage: "fridge", keeps: 7, search: "british whole milk 4 pints", contains: ["milk"] },
  { key: "greek-yoghurt", name: "Greek-style yoghurt", aisle: "Dairy", per100: m(133, 5.7, 10.2, 4.8), source: cofid("12-555"), unit: "g", pack: { qty: 1000, unit: "g", pence: 220 }, storage: "fridge", keeps: 10, search: "greek style natural yogurt 1kg", contains: ["milk"], watch: ["legume-gum"] },
  { key: "double-cream", name: "Double cream", aisle: "Dairy", per100: m(496, 1.6, 53.7, 1.7), source: cofid("12-334"), unit: "ml", pack: { qty: 300, unit: "ml", pence: 150 }, storage: "fridge", keeps: 5, search: "double cream 300ml", contains: ["milk"] },
  { key: "cream-cheese", name: "Full-fat soft cheese", aisle: "Dairy", per100: m(235, 5.4, 22.0, 4.0), source: LABEL, unit: "g", pack: { qty: 180, unit: "g", pence: 130 }, storage: "fridge", keeps: 7, search: "full fat soft cheese", contains: ["milk"], watch: ["legume-gum"] },
  { key: "cheddar", name: "Mature cheddar", aisle: "Dairy", per100: m(416, 25.4, 34.9, 0.1), source: cofid("12-346"), unit: "g", pack: { qty: 400, unit: "g", pence: 350 }, storage: "fridge", keeps: 21, search: "mature cheddar 400g", contains: ["milk"] },
  { key: "mozzarella", name: "Mozzarella", aisle: "Dairy", per100: m(257, 18.6, 20.3, 0), source: cofid("12-360"), unit: "g", pack: { qty: 125, unit: "g", pence: 85 }, storage: "fridge", keeps: 5, search: "mozzarella 125g", contains: ["milk"] },
  { key: "parmesan", name: "Italian hard cheese (Parmesan or Grana Padano)", aisle: "Dairy", per100: m(415, 36.2, 29.7, 0.9), source: cofid("12-526"), unit: "g", pack: { qty: 200, unit: "g", pence: 350 }, storage: "fridge", keeps: 28, search: "grana padano 200g", contains: ["milk"] },
  { key: "butter", name: "Butter", aisle: "Dairy", per100: m(744, 0.6, 82.2, 0.6), source: cofid("17-685"), unit: "g", pack: { qty: 250, unit: "g", pence: 210 }, storage: "fridge", keeps: 30, search: "salted butter 250g", contains: ["milk"] },
  { key: "egg", name: "Eggs", aisle: "Dairy", per100: m(131, 12.6, 9.0, 0), source: cofid("12-937"), unit: "each", each: 50, pack: { qty: 6, unit: "each", pence: 160 }, storage: "fridge", keeps: 21, search: "free range eggs medium 6", contains: ["egg"] },

  // Bakery
  { key: "bagel", name: "Plain bagels", aisle: "Bakery", per100: m(273, 10.0, 1.8, 57.8), source: cofid("11-970"), unit: "each", each: 85, pack: { qty: 5, unit: "each", pence: 125 }, storage: "cupboard", keeps: 5, search: "plain bagels 5 pack", contains: ["gluten"], watch: ["soy", "sesame", "egg:baked"] },
  { key: "tortilla", name: "Large tortilla wraps", aisle: "Bakery", per100: m(285, 7.8, 5.7, 53.9), source: cofid("11-925"), unit: "each", each: 62, pack: { qty: 8, unit: "each", pence: 120 }, storage: "cupboard", keeps: 10, search: "plain tortilla wraps 8", contains: ["gluten"], watch: ["soy"] },
  { key: "pitta", name: "White pitta breads", aisle: "Bakery", per100: m(255, 9.1, 1.3, 55.1), source: cofid("11-974"), unit: "each", each: 58, pack: { qty: 6, unit: "each", pence: 75 }, storage: "cupboard", keeps: 5, search: "white pitta bread 6", contains: ["gluten"], watch: ["soy", "sesame"] },
  { key: "naan", name: "Plain naans", aisle: "Bakery", per100: m(285, 7.8, 7.3, 50.2), source: cofid("11-973"), unit: "each", each: 130, pack: { qty: 2, unit: "each", pence: 110 }, storage: "cupboard", keeps: 5, search: "plain naan breads", contains: ["gluten", "milk"], watch: ["soy", "egg:baked", "sesame"] },
  { key: "burger-bun", name: "Brioche burger buns", aisle: "Bakery", per100: m(254, 9.3, 2.6, 51.5), source: cofid("11-1006") + " (soft white roll)", unit: "each", each: 60, pack: { qty: 4, unit: "each", pence: 130 }, storage: "cupboard", keeps: 5, search: "brioche burger buns", contains: ["gluten"], watch: ["soy", "egg:baked", "sesame", "milk"] },
  { key: "white-bread", name: "White bread", aisle: "Bakery", per100: m(219, 7.9, 1.6, 46.1), source: cofid("11-980"), unit: "g", pack: { qty: 800, unit: "g", pence: 120 }, storage: "cupboard", keeps: 5, search: "white bread 800g", contains: ["gluten"], watch: ["soy"] },
  { key: "panko", name: "Panko breadcrumbs", aisle: "Bakery", per100: m(360, 11.0, 2.5, 74.0), source: LABEL, unit: "g", pack: { qty: 180, unit: "g", pence: 120 }, storage: "cupboard", search: "panko breadcrumbs", contains: ["gluten"], watch: ["soy", "egg:baked"] },

  // Pasta, rice and grains
  { key: "pasta", name: "Dried pasta (spaghetti, penne or rigatoni)", aisle: "Pasta, rice & grains", per100: m(343, 11.3, 1.6, 75.6), source: cofid("11-716"), unit: "g", pack: { qty: 1000, unit: "g", pence: 130 }, storage: "cupboard", search: "spaghetti 1kg", contains: ["gluten"] },
  { key: "lasagne-sheets", name: "Dried lasagne sheets", aisle: "Pasta, rice & grains", per100: m(343, 11.3, 1.6, 75.6), source: cofid("11-716"), unit: "g", pack: { qty: 500, unit: "g", pence: 120 }, storage: "cupboard", search: "lasagne sheets", contains: ["gluten"], watch: ["egg:pasta"] },
  { key: "orzo", name: "Orzo", aisle: "Pasta, rice & grains", per100: m(343, 11.3, 1.6, 75.6), source: cofid("11-716"), unit: "g", pack: { qty: 500, unit: "g", pence: 150 }, storage: "cupboard", search: "orzo pasta", contains: ["gluten"] },
  { key: "gnocchi", name: "Potato gnocchi", aisle: "Pasta, rice & grains", per100: m(150, 3.5, 0.3, 33.0), source: LABEL, unit: "g", pack: { qty: 500, unit: "g", pence: 120 }, storage: "fridge", keeps: 14, search: "potato gnocchi 500g", contains: ["gluten"], watch: ["egg:pasta", "soy"] },
  { key: "basmati", name: "Basmati rice", aisle: "Pasta, rice & grains", per100: m(351, 8.1, 0.5, 83.7), source: cofid("11-857"), unit: "g", pack: { qty: 1000, unit: "g", pence: 240 }, storage: "cupboard", search: "basmati rice 1kg" },
  { key: "jasmine", name: "Jasmine rice", aisle: "Pasta, rice & grains", per100: m(355, 6.7, 1.0, 85.1), source: cofid("11-861") + " (long grain)", unit: "g", pack: { qty: 1000, unit: "g", pence: 250 }, storage: "cupboard", search: "thai jasmine rice 1kg" },
  { key: "arborio", name: "Risotto rice", aisle: "Pasta, rice & grains", per100: m(354, 6.4, 1.0, 85.2), source: cofid("11-878"), unit: "g", pack: { qty: 500, unit: "g", pence: 160 }, storage: "cupboard", search: "arborio risotto rice" },
  { key: "rice-noodles", name: "Dried rice noodles", aisle: "Pasta, rice & grains", per100: m(364, 6.0, 0.6, 81.0), source: LABEL, unit: "g", pack: { qty: 250, unit: "g", pence: 120 }, storage: "cupboard", search: "rice noodles 250g", watch: ["soy"] },
  { key: "couscous", name: "Couscous", aisle: "Pasta, rice & grains", per100: m(364, 12.0, 2.1, 79.2), source: cofid("11-901"), unit: "g", pack: { qty: 500, unit: "g", pence: 95 }, storage: "cupboard", search: "couscous 500g", contains: ["gluten"] },
  { key: "oats", name: "Porridge oats", aisle: "Pasta, rice & grains", per100: m(381, 10.9, 8.1, 70.7), source: cofid("11-788"), unit: "g", pack: { qty: 1000, unit: "g", pence: 110 }, storage: "cupboard", search: "porridge oats 1kg", contains: ["gluten"] },
  { key: "potato", name: "White potatoes", aisle: "Fruit & veg", per100: m(82, 1.9, 0.1, 19.6), source: cofid("13-489"), unit: "g", pack: { qty: 2500, unit: "g", pence: 160 }, storage: "cupboard", keeps: 14, search: "white potatoes 2.5kg" },
  { key: "baby-potato", name: "Baby potatoes", aisle: "Fruit & veg", per100: m(68, 1.7, 0.1, 16.1), source: cofid("13-618"), unit: "g", pack: { qty: 1000, unit: "g", pence: 110 }, storage: "cupboard", keeps: 10, search: "baby potatoes 1kg" },
  { key: "sweet-potato", name: "Sweet potatoes", aisle: "Fruit & veg", per100: m(87, 1.2, 0.3, 21.3), source: cofid("13-463"), unit: "g", pack: { qty: 1000, unit: "g", pence: 130 }, storage: "cupboard", keeps: 14, search: "sweet potatoes 1kg" },

  // Fruit and veg
  { key: "onion", name: "Onions", aisle: "Fruit & veg", per100: m(35, 1.0, 0.1, 8.0), source: cofid("13-499"), unit: "each", each: 150, pack: { qty: 6, unit: "each", pence: 90 }, storage: "cupboard", keeps: 21, search: "brown onions" },
  { key: "red-onion", name: "Red onions", aisle: "Fruit & veg", per100: m(35, 1.0, 0.1, 8.0), source: cofid("13-499"), unit: "each", each: 150, pack: { qty: 3, unit: "each", pence: 75 }, storage: "cupboard", keeps: 21, search: "red onions" },
  { key: "garlic", name: "Garlic (cloves)", aisle: "Fruit & veg", per100: m(98, 7.9, 0.6, 16.3), source: cofid("13-244"), unit: "each", each: 5, pack: { qty: 40, unit: "each", pence: 90 }, storage: "cupboard", keeps: 28, search: "garlic 4 pack" },
  { key: "ginger", name: "Fresh ginger", aisle: "Fruit & veg", per100: m(44, 1.8, 0.8, 8.1), source: cofid("13-890"), unit: "g", pack: { qty: 100, unit: "g", pence: 60 }, storage: "fridge", keeps: 21, search: "root ginger" },
  { key: "carrot", name: "Carrots", aisle: "Fruit & veg", per100: m(34, 0.5, 0.4, 7.7), source: cofid("13-496"), unit: "g", pack: { qty: 1000, unit: "g", pence: 55 }, storage: "fridge", keeps: 14, search: "carrots 1kg" },
  { key: "celery", name: "Celery", aisle: "Fruit & veg", per100: m(9, 0.5, 0.1, 1.4), source: cofid("13-636"), unit: "g", pack: { qty: 400, unit: "g", pence: 80 }, storage: "fridge", keeps: 10, search: "celery", contains: ["celery"] },
  { key: "pepper", name: "Peppers (red, yellow or orange)", aisle: "Fruit & veg", per100: m(32, 1.0, 0.3, 6.4), source: LABEL, unit: "each", each: 160, pack: { qty: 3, unit: "each", pence: 150 }, storage: "fridge", keeps: 7, search: "mixed peppers 3 pack" },
  { key: "chopped-tomatoes", name: "Chopped tomatoes (400 g tin)", aisle: "Tins & jars", per100: m(19, 1.1, 0.1, 3.8), source: cofid("13-530"), unit: "g", pack: { qty: 400, unit: "g", pence: 45 }, storage: "cupboard", search: "chopped tomatoes 400g" },
  { key: "passata", name: "Passata", aisle: "Tins & jars", per100: m(19, 1.1, 0.1, 3.8), source: cofid("13-530"), unit: "g", pack: { qty: 500, unit: "g", pence: 65 }, storage: "cupboard", search: "passata 500g" },
  { key: "tomato-puree", name: "Tomato purée", aisle: "Tins & jars", per100: m(67, 4.4, 0.2, 12.9), source: cofid("13-531"), unit: "g", pack: { qty: 200, unit: "g", pence: 70 }, storage: "cupboard", search: "tomato puree tube" },
  { key: "cherry-tomatoes", name: "Cherry tomatoes", aisle: "Fruit & veg", per100: m(22, 1.1, 0.5, 3.6), source: cofid("13-519"), unit: "g", pack: { qty: 250, unit: "g", pence: 95 }, storage: "fridge", keeps: 7, search: "cherry tomatoes 250g" },
  { key: "sundried-tomatoes", name: "Sun-dried tomatoes in oil", aisle: "Tins & jars", per100: m(214, 4.7, 15.0, 13.0), source: LABEL, unit: "g", pack: { qty: 280, unit: "g", pence: 250 }, storage: "cupboard", search: "sundried tomatoes in oil" },
  { key: "spinach", name: "Baby spinach", aisle: "Fruit & veg", per100: m(16, 2.6, 0.6, 0.2), source: cofid("13-521"), unit: "g", pack: { qty: 240, unit: "g", pence: 140 }, storage: "fridge", keeps: 4, search: "baby spinach 240g" },
  { key: "broccoli", name: "Broccoli", aisle: "Fruit & veg", per100: m(34, 4.3, 0.6, 3.2), source: cofid("13-502"), unit: "g", pack: { qty: 350, unit: "g", pence: 75 }, storage: "fridge", keeps: 5, search: "broccoli" },
  { key: "courgette", name: "Courgettes", aisle: "Fruit & veg", per100: m(16, 1.3, 0.2, 2.3), source: cofid("13-627"), unit: "each", each: 200, pack: { qty: 3, unit: "each", pence: 120 }, storage: "fridge", keeps: 7, search: "courgettes" },
  { key: "cucumber", name: "Cucumber", aisle: "Fruit & veg", per100: m(14, 1.0, 0.6, 1.2), source: cofid("13-523"), unit: "each", each: 350, pack: { qty: 1, unit: "each", pence: 75 }, storage: "fridge", keeps: 7, search: "cucumber" },
  { key: "leek", name: "Leeks", aisle: "Fruit & veg", per100: m(23, 1.5, 0.2, 4.1), source: cofid("13-624"), unit: "g", pack: { qty: 500, unit: "g", pence: 110 }, storage: "fridge", keeps: 10, search: "leeks" },
  { key: "spring-onion", name: "Spring onions", aisle: "Fruit & veg", per100: m(23, 2.0, 0.5, 3.0), source: cofid("13-352"), unit: "g", pack: { qty: 100, unit: "g", pence: 60 }, storage: "fridge", keeps: 7, search: "spring onions" },
  { key: "sweetcorn", name: "Frozen sweetcorn", aisle: "Frozen", per100: m(60, 3.4, 1.8, 8.1), source: cofid("13-622"), unit: "g", pack: { qty: 750, unit: "g", pence: 120 }, storage: "freezer", search: "frozen sweetcorn" },
  { key: "chilli", name: "Red chillies", aisle: "Fruit & veg", per100: m(26, 1.8, 0.3, 4.2), source: cofid("13-317"), unit: "each", each: 15, pack: { qty: 4, unit: "each", pence: 65 }, storage: "fridge", keeps: 10, search: "red chillies", traits: ["spicy"] },
  { key: "lemon", name: "Lemons", aisle: "Fruit & veg", per100: m(19, 1.0, 0.3, 3.2), source: cofid("14-128"), unit: "each", each: 100, pack: { qty: 4, unit: "each", pence: 100 }, storage: "fridge", keeps: 21, search: "lemons 4 pack" },
  { key: "lime", name: "Limes", aisle: "Fruit & veg", per100: m(9, 0.4, 0.1, 1.6), source: cofid("14-279") + " (juice)", unit: "each", each: 60, pack: { qty: 4, unit: "each", pence: 100 }, storage: "fridge", keeps: 21, search: "limes 4 pack" },
  { key: "basil", name: "Fresh basil", aisle: "Fruit & veg", per100: m(40, 3.1, 0.8, 5.1), source: cofid("13-804"), unit: "g", pack: { qty: 30, unit: "g", pence: 80 }, storage: "fridge", keeps: 5, search: "fresh basil" },
  { key: "coriander", name: "Fresh coriander", aisle: "Fruit & veg", per100: m(18, 2.1, 0.5, 1.2), source: cofid("13-888"), unit: "g", pack: { qty: 30, unit: "g", pence: 80 }, storage: "fridge", keeps: 5, search: "fresh coriander" },
  { key: "parsley", name: "Fresh parsley", aisle: "Fruit & veg", per100: m(34, 3.0, 1.3, 2.7), source: cofid("13-844"), unit: "g", pack: { qty: 30, unit: "g", pence: 80 }, storage: "fridge", keeps: 5, search: "fresh flat leaf parsley" },
  { key: "raspberries", name: "Frozen raspberries", aisle: "Frozen", per100: m(25, 0.8, 0.3, 5.1), source: cofid("14-375"), unit: "g", pack: { qty: 350, unit: "g", pence: 200 }, storage: "freezer", search: "frozen raspberries" },
  { key: "blueberries", name: "Frozen blueberries", aisle: "Frozen", per100: m(40, 0.9, 0.2, 9.1), source: cofid("14-325"), unit: "g", pack: { qty: 400, unit: "g", pence: 225 }, storage: "freezer", search: "frozen blueberries" },
  { key: "pineapple", name: "Pineapple chunks in juice (tin)", aisle: "Tins & jars", per100: m(47, 0.3, 0, 12.2), source: cofid("14-211"), unit: "g", pack: { qty: 432, unit: "g", pence: 85 }, storage: "cupboard", search: "pineapple chunks in juice" },

  // Sauces and oils
  { key: "olive-oil", name: "Olive oil", aisle: "Sauces & oils", per100: m(818, 0, 90.9, 0), source: cofid("17-038") + " (per 100 ml)", unit: "ml", pack: { qty: 500, unit: "ml", pence: 450 }, storage: "cupboard", staple: true, search: "olive oil 500ml" },
  { key: "veg-oil", name: "Vegetable or rapeseed oil", aisle: "Sauces & oils", per100: m(818, 0, 90.9, 0), source: cofid("17-041") + " (per 100 ml)", unit: "ml", pack: { qty: 1000, unit: "ml", pence: 200 }, storage: "cupboard", staple: true, search: "rapeseed oil 1 litre", watch: ["nut-oil"] },
  { key: "coconut-milk", name: "Coconut milk (400 ml tin)", aisle: "Tins & jars", per100: m(169, 1.1, 16.9, 3.3), source: cofid("14-889"), unit: "ml", pack: { qty: 400, unit: "ml", pence: 95 }, storage: "cupboard", search: "coconut milk 400ml", contains: ["coconut"] },
  { key: "coconut-aminos", name: "Coconut aminos (soy-free soy sauce)", aisle: "Sauces & oils", per100: m(100, 0, 0, 24), source: LABEL, unit: "ml", pack: { qty: 250, unit: "ml", pence: 400 }, storage: "cupboard", staple: true, search: "coconut aminos", contains: ["coconut"] },
  { key: "fish-sauce", name: "Fish sauce", aisle: "Sauces & oils", per100: m(40, 6.0, 0, 4.0), source: LABEL, unit: "ml", pack: { qty: 150, unit: "ml", pence: 150 }, storage: "cupboard", staple: true, search: "fish sauce", contains: ["fish"] },
  { key: "rice-vinegar", name: "Rice vinegar", aisle: "Sauces & oils", per100: m(22, 0.4, 0, 0.6), source: cofid("17-339"), unit: "ml", pack: { qty: 150, unit: "ml", pence: 140 }, storage: "cupboard", staple: true, search: "rice vinegar" },
  { key: "honey", name: "Runny honey", aisle: "Sauces & oils", per100: m(288, 0.4, 0, 76.4), source: cofid("17-050"), unit: "g", pack: { qty: 340, unit: "g", pence: 160 }, storage: "cupboard", staple: true, search: "squeezy clear honey" },
  { key: "sweet-chilli", name: "Sweet chilli sauce", aisle: "Sauces & oils", per100: m(225, 0.3, 0.2, 55.0), source: LABEL, unit: "g", pack: { qty: 290, unit: "g", pence: 110 }, storage: "cupboard", search: "sweet chilli sauce", watch: ["soy"] },
  { key: "ketchup", name: "Tomato ketchup", aisle: "Sauces & oils", per100: m(115, 1.6, 0.1, 28.6), source: cofid("17-709"), unit: "g", pack: { qty: 460, unit: "g", pence: 160 }, storage: "cupboard", staple: true, search: "tomato ketchup", watch: ["apple:processed"] },
  { key: "bbq-sauce", name: "BBQ sauce", aisle: "Sauces & oils", per100: m(140, 1.0, 0.1, 36.1), source: cofid("17-705"), unit: "g", pack: { qty: 480, unit: "g", pence: 140 }, storage: "cupboard", search: "bbq sauce", watch: ["apple:processed", "tamarind", "soy", "mustard"] },
  { key: "stock-chicken", name: "Chicken stock cubes", aisle: "Sauces & oils", per100: m(250, 10.0, 15.0, 15.0), source: LABEL, unit: "each", each: 10, pack: { qty: 12, unit: "each", pence: 100 }, storage: "cupboard", staple: true, search: "chicken stock cubes", watch: ["soy", "celery", "gluten"] },
  { key: "stock-beef", name: "Beef stock cubes", aisle: "Sauces & oils", per100: m(250, 10.0, 15.0, 15.0), source: LABEL, unit: "each", each: 10, pack: { qty: 12, unit: "each", pence: 100 }, storage: "cupboard", staple: true, search: "beef stock cubes", watch: ["soy", "celery", "gluten"] },
  { key: "gravy", name: "Gravy granules", aisle: "Sauces & oils", per100: m(407, 4.4, 16.1, 65.2), source: cofid("17-724"), unit: "g", pack: { qty: 170, unit: "g", pence: 150 }, storage: "cupboard", staple: true, search: "gravy granules for meat", watch: ["soy", "gluten"] },
  { key: "thai-green-paste", name: "Thai green curry paste", aisle: "Sauces & oils", per100: m(120, 2.0, 7.0, 12.0), source: LABEL, unit: "g", pack: { qty: 195, unit: "g", pence: 200 }, storage: "cupboard", search: "thai green curry paste", traits: ["spicy"], contains: ["crustacean"], watch: ["peanut", "soy", "tree-nut"] },

  // Herbs and spices: a teaspoon here and there, so they are staples.
  ...(
    [
      ["paprika", "Paprika", 289, 14, 13, 19, "Typical"],
      ["smoked-paprika", "Smoked paprika", 289, 14, 13, 19, "Typical"],
      ["cumin", "Ground cumin", 375, 18, 22, 34, "Typical"],
      ["ground-coriander", "Ground coriander", 298, 12, 18, 13, "Typical"],
      ["turmeric", "Ground turmeric", 312, 10, 3, 65, "Typical"],
      ["garam-masala", "Garam masala", 379, 15.6, 15.1, 45.2, cofid("13-829")],
      ["cinnamon", "Ground cinnamon", 247, 4, 1.2, 27, "Typical"],
      ["allspice", "Ground allspice", 263, 6, 9, 50, "Typical"],
      ["ground-ginger", "Ground ginger", 284, 7.4, 3.3, 60, cofid("13-832")],
      ["garlic-powder", "Garlic powder", 246, 18.7, 1.2, 42.7, cofid("13-830")],
      ["five-spice", "Chinese five spice", 340, 11, 10, 50, "Typical"],
      ["chilli-flakes", "Chilli flakes", 314, 13, 14, 30, "Typical"],
      ["oregano", "Dried oregano", 265, 9, 4.3, 27, "Typical"],
      ["thyme", "Dried thyme", 276, 9.1, 7.4, 45.3, cofid("13-883")],
      ["mixed-herbs", "Dried mixed herbs", 261, 12.1, 8.5, 36.3, cofid("13-884")],
      ["black-pepper", "Black pepper", 251, 10.4, 3.3, 39, "Typical"],
      ["salt", "Salt", 0, 0, 0, 0, cofid("17-367")],
    ] as const
  ).map(([key, name, kcal, p, f, c, src]): Ingredient => ({
    key,
    name,
    aisle: "Herbs & spices",
    per100: m(kcal, p, f, c),
    source: src === "Typical" ? LABEL : src,
    unit: "g",
    pack: { qty: key === "salt" ? 750 : 40, unit: "g", pence: key === "salt" ? 65 : 110 },
    storage: "cupboard",
    staple: true,
    search: name.toLowerCase(),
    traits: key === "chilli-flakes" ? ["spicy"] : undefined,
    // Some spice blends add fenugreek or pea flour.
    watch: key === "garam-masala" || key === "five-spice" ? (["fenugreek"] as Watch[]) : undefined,
  })),

  // Baking
  { key: "flour", name: "Plain flour", aisle: "Baking", per100: m(352, 9.1, 1.4, 80.9), source: cofid("11-886"), unit: "g", pack: { qty: 1500, unit: "g", pence: 100 }, storage: "cupboard", staple: true, search: "plain flour 1.5kg", contains: ["gluten"] },
  { key: "sr-flour", name: "Self-raising flour", aisle: "Baking", per100: m(348, 8.9, 1.5, 79.6), source: cofid("11-888"), unit: "g", pack: { qty: 1500, unit: "g", pence: 100 }, storage: "cupboard", search: "self raising flour 1.5kg", contains: ["gluten"] },
  { key: "cornflour", name: "Cornflour", aisle: "Baking", per100: m(354, 0.6, 0.1, 88.0), source: LABEL, unit: "g", pack: { qty: 500, unit: "g", pence: 125 }, storage: "cupboard", staple: true, search: "cornflour" },
  { key: "baking-powder", name: "Baking powder", aisle: "Baking", per100: m(163, 5.2, 0, 37.8), source: cofid("17-355"), unit: "g", pack: { qty: 170, unit: "g", pence: 100 }, storage: "cupboard", staple: true, search: "baking powder" },
  { key: "brown-sugar", name: "Light brown sugar", aisle: "Baking", per100: m(380, 0.1, 0, 101.3), source: cofid("17-060"), unit: "g", pack: { qty: 500, unit: "g", pence: 110 }, storage: "cupboard", staple: true, search: "light brown soft sugar" },
  { key: "cocoa", name: "Cocoa powder", aisle: "Baking", per100: m(312, 18.5, 21.7, 11.5), source: cofid("12-545"), unit: "g", pack: { qty: 250, unit: "g", pence: 250 }, storage: "cupboard", search: "cocoa powder", watch: ["milk"] },
  { key: "sunflower-seeds", name: "Sunflower seeds", aisle: "Baking", per100: m(576, 19.8, 47.5, 18.6), source: cofid("14-845"), unit: "g", pack: { qty: 200, unit: "g", pence: 120 }, storage: "cupboard", search: "sunflower seeds", watch: ["tree-nut", "peanut"] },
  { key: "puff-pastry", name: "Ready-rolled puff pastry", aisle: "Baking", per100: m(384, 5.3, 26.2, 33.7), source: cofid("11-852"), unit: "g", pack: { qty: 320, unit: "g", pence: 130 }, storage: "fridge", keeps: 14, search: "ready rolled puff pastry", contains: ["gluten"], watch: ["egg:baked", "soy"] },

  // Supplements
  { key: "rice-protein", name: "Rice protein powder", aisle: "Supplements", per100: m(380, 80, 3, 6), source: LABEL, unit: "g", pack: { qty: 1000, unit: "g", pence: 2200 }, storage: "cupboard", staple: true, search: "rice protein powder", watch: ["pea", "soy"] },
];

export const INGREDIENTS: ReadonlyMap<string, Ingredient> = new Map(LIST.map((i) => [i.key, i]));

export function ingredient(key: string): Ingredient {
  const found = INGREDIENTS.get(key);
  if (!found) throw new Error(`Unknown ingredient ${key}`);
  return found;
}

/** Grams (or ml) in a quantity of an ingredient. */
export function toGrams(item: Ingredient, qty: number, unit: Unit = item.unit): number {
  if (unit === "each") return qty * (item.each ?? 0);
  return qty;
}

/** A quantity in the ingredient's own unit, from grams (or ml). */
export function fromGrams(item: Ingredient, grams: number): number {
  return item.unit === "each" ? grams / (item.each || 1) : grams;
}

export function macrosOf(item: Ingredient, qty: number, unit: Unit = item.unit): Macros {
  const g = toGrams(item, qty, unit) / 100;
  return {
    kcal: item.per100.kcal * g,
    protein: item.per100.protein * g,
    fat: item.per100.fat * g,
    carbs: item.per100.carbs * g,
  };
}

/** Sainsbury's own search for an ingredient, for when no product is picked yet. */
export function sainsburysSearch(term: string): string {
  return `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(term)}`;
}

/** Only Sainsbury's product pages, so a stored link can never point elsewhere. */
export function isSainsburysProduct(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^(www\.)?sainsburys\.co\.uk$/.test(u.hostname) && /^\/(gol-ui|groceries|shop\/gb\/groceries)\/product\//.test(u.pathname);
  } catch {
    return false;
  }
}

/** Pack size from a Sainsbury's product slug like "...-thigh-fillets-1kg" or "...-x6". */
export function packFromSlug(url: string): { qty: number; unit: Unit } | null {
  const slug = url.split("/").pop()?.toLowerCase() ?? "";
  const weight = /(?:^|-)(\d+(?:\.\d+)?)(kg|g|ml|l|litre|litres)(?:-|$)/.exec(slug);
  if (weight) {
    const n = Number(weight[1]);
    const u = weight[2];
    if (u === "kg") return { qty: n * 1000, unit: "g" };
    if (u === "g") return { qty: n, unit: "g" };
    if (u === "ml") return { qty: n, unit: "ml" };
    return { qty: n * 1000, unit: "ml" };
  }
  const count = /(?:^|-)x?(\d{1,2})(?:-?pack|-?pk)?(?:-|$)/.exec(slug.replace(/-(\d+)-pack/, "-x$1"));
  if (count && /x\d|pack|pk/.test(slug)) return { qty: Number(count[1]), unit: "each" };
  return null;
}
