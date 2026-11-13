---
paths:
  - "src/lib/life/**"
  - "src/app/life/**"
---

# Life space rules

- The owner's profile and food rules (allergies with their nuance) live only in
  the database. Never write them into code, tests, seeds or docs; tests use
  made-up rules.
- Recipes are batch-cooked bulking portions; nutrition comes from CoFID 2021,
  cited by food code in `ingredients.ts`; storage follows the Food Standards
  Agency (2 days in the fridge, rice 1). Keep those sources when adding recipes.
- Every recipe line says how egg is used, and ingredients list what some brands
  add, so `allergens.ts` can apply nuanced rules. A test checks every recipe
  against the strictest rules the library is written for: keep it passing.
- Sainsbury's has no API and bars bots: the basket links products, it never orders.
