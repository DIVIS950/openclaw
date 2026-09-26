export type Region = {
  flag: string;
  country: string;
  currency: string;
  language: string;
  vintedDomain: string;
};

export const REGIONS: Region[] = [
  { flag: "🇺🇸", country: "United States", currency: "USD", language: "English", vintedDomain: "www.vinted.com" },
  { flag: "🇬🇧", country: "United Kingdom", currency: "GBP", language: "English", vintedDomain: "www.vinted.co.uk" },
  { flag: "🇨🇿", country: "Czechia", currency: "CZK", language: "Czech", vintedDomain: "www.vinted.cz" },
  { flag: "🇸🇰", country: "Slovakia", currency: "EUR", language: "Slovak", vintedDomain: "www.vinted.sk" },
  { flag: "🇩🇪", country: "Germany", currency: "EUR", language: "German", vintedDomain: "www.vinted.de" },
  { flag: "🇦🇹", country: "Austria", currency: "EUR", language: "German", vintedDomain: "www.vinted.at" },
  { flag: "🇫🇷", country: "France", currency: "EUR", language: "French", vintedDomain: "www.vinted.fr" },
  { flag: "🇪🇸", country: "Spain", currency: "EUR", language: "Spanish", vintedDomain: "www.vinted.es" },
  { flag: "🇮🇹", country: "Italy", currency: "EUR", language: "Italian", vintedDomain: "www.vinted.it" },
  { flag: "🇳🇱", country: "Netherlands", currency: "EUR", language: "Dutch", vintedDomain: "www.vinted.nl" },
  { flag: "🇵🇱", country: "Poland", currency: "PLN", language: "Polish", vintedDomain: "www.vinted.pl" },
];

export const LANGUAGES = ["English", "Czech", "Slovak", "German", "French", "Spanish", "Italian", "Dutch", "Polish"];
