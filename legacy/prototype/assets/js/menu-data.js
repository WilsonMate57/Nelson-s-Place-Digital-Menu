// Conteúdo demonstrativo. Substituir por dados aprovados pelo Nelson's Place.
export const categories = [
  { id: "starters", name: { pt: "Entradas", en: "Starters", fr: "Entrées", es: "Entrantes" }, sortOrder: 1 },
  { id: "mains", name: { pt: "Pratos principais", en: "Main courses", fr: "Plats principaux", es: "Platos principales" }, sortOrder: 2 },
  { id: "drinks", name: { pt: "Bebidas", en: "Drinks", fr: "Boissons", es: "Bebidas" }, sortOrder: 3 },
  { id: "desserts", name: { pt: "Sobremesas", en: "Desserts", fr: "Desserts", es: "Postres" }, sortOrder: 4 }
];

export const products = [
  {
    id: "soup-of-day", categoryId: "starters",
    name: { pt: "Sopa do dia", en: "Soup of the day", fr: "Soupe du jour", es: "Sopa del día" },
    description: { pt: "Consulte a equipa para conhecer a sopa disponível.", en: "Ask our team about today's soup.", fr: "Demandez à notre équipe la soupe du jour.", es: "Consulte a nuestro equipo sobre la sopa del día." },
    price: 250, currency: "MZN", image: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
    available: true, allergens: [], modifiers: []
  },
  {
    id: "grilled-chicken", categoryId: "mains",
    name: { pt: "Frango grelhado", en: "Grilled chicken", fr: "Poulet grillé", es: "Pollo a la parrilla" },
    description: { pt: "Prato demonstrativo. Confirmar acompanhamentos e ingredientes.", en: "Demo item. Confirm sides and ingredients.", fr: "Exemple. Confirmez les accompagnements et ingrédients.", es: "Ejemplo. Confirme guarniciones e ingredientes." },
    price: 650, currency: "MZN", image: "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=900&q=80",
    available: true, allergens: [], modifiers: [
      { id: "remove-onion", type: "remove", name: { pt: "Sem cebola", en: "No onion", fr: "Sans oignon", es: "Sin cebolla" }, price: 0 },
      { id: "extra-sauce", type: "extra", name: { pt: "Molho extra", en: "Extra sauce", fr: "Sauce supplémentaire", es: "Salsa extra" }, price: 50 }
    ]
  },
  {
    id: "fresh-juice", categoryId: "drinks",
    name: { pt: "Sumo natural", en: "Fresh juice", fr: "Jus frais", es: "Zumo natural" },
    description: { pt: "Sabor sujeito à disponibilidade.", en: "Flavour subject to availability.", fr: "Parfum selon disponibilité.", es: "Sabor sujeto a disponibilidad." },
    price: 180, currency: "MZN", image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=900&q=80",
    available: true, allergens: [], modifiers: []
  },
  {
    id: "cake-slice", categoryId: "desserts",
    name: { pt: "Fatia de bolo", en: "Slice of cake", fr: "Part de gâteau", es: "Porción de tarta" },
    description: { pt: "Sobremesa demonstrativa. Confirmar variedade do dia.", en: "Demo dessert. Confirm today's selection.", fr: "Dessert exemple. Confirmez la sélection du jour.", es: "Postre de ejemplo. Confirme la selección del día." },
    price: 220, currency: "MZN", image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80",
    available: true, allergens: [], modifiers: []
  }
];
