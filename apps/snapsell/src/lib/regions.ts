export type Region = {
  /** ISO 3166-1 alpha-2 country code */
  code: string;
  country: string;
  currency: string;
  language: string;
  vintedDomain: string;
};

export const REGIONS: Region[] = [
  { code: "US", country: "United States", currency: "USD", language: "English", vintedDomain: "www.vinted.com" },
  { code: "GB", country: "United Kingdom", currency: "GBP", language: "English", vintedDomain: "www.vinted.co.uk" },
  { code: "CZ", country: "Czechia", currency: "CZK", language: "Czech", vintedDomain: "www.vinted.cz" },
  { code: "SK", country: "Slovakia", currency: "EUR", language: "Slovak", vintedDomain: "www.vinted.sk" },
  { code: "DE", country: "Germany", currency: "EUR", language: "German", vintedDomain: "www.vinted.de" },
  { code: "AT", country: "Austria", currency: "EUR", language: "German", vintedDomain: "www.vinted.at" },
  { code: "FR", country: "France", currency: "EUR", language: "French", vintedDomain: "www.vinted.fr" },
  { code: "ES", country: "Spain", currency: "EUR", language: "Spanish", vintedDomain: "www.vinted.es" },
  { code: "IT", country: "Italy", currency: "EUR", language: "Italian", vintedDomain: "www.vinted.it" },
  { code: "NL", country: "Netherlands", currency: "EUR", language: "Dutch", vintedDomain: "www.vinted.nl" },
  { code: "PL", country: "Poland", currency: "PLN", language: "Polish", vintedDomain: "www.vinted.pl" },
];

export const LANGUAGES = ["English", "Czech", "Slovak", "German", "French", "Spanish", "Italian", "Dutch", "Polish"];
