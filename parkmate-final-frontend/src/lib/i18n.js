// Menu-label translations for the account menu. Only the menu is translated for now.
export const LANGUAGES = { en: 'English', ta: 'தமிழ்', hi: 'हिन्दी' };

export const MENU_TEXT = {
  en: { profile: 'Profile', orders: 'Orders', payments: 'Payment history', settings: 'Settings', language: 'Language', help: 'Help & support', appearance: 'Appearance', light: 'Light', dark: 'Dark', logout: 'Log out', signingOut: 'Signing out…', toProvider: 'Switch to Provider dashboard', toConsumer: 'Switch to Consumer dashboard', consumerView: 'Consumer', providerView: 'Provider' },
  ta: { profile: 'சுயவிவரம்', orders: 'ஆர்டர்கள்', payments: 'கட்டண வரலாறு', settings: 'அமைப்புகள்', language: 'மொழி', help: 'உதவி மற்றும் ஆதரவு', appearance: 'தோற்றம்', light: 'ஒளி', dark: 'இருள்', logout: 'வெளியேறு', signingOut: 'வெளியேறுகிறது…', toProvider: 'வழங்குநர் டாஷ்போர்டுக்கு மாறு', toConsumer: 'நுகர்வோர் டாஷ்போர்டுக்கு மாறு', consumerView: 'நுகர்வோர்', providerView: 'வழங்குநர்' },
  hi: { profile: 'प्रोफ़ाइल', orders: 'ऑर्डर', payments: 'भुगतान इतिहास', settings: 'सेटिंग्स', language: 'भाषा', help: 'सहायता और समर्थन', appearance: 'दिखावट', light: 'लाइट', dark: 'डार्क', logout: 'लॉग आउट', signingOut: 'साइन आउट हो रहा है…', toProvider: 'प्रदाता डैशबोर्ड पर जाएँ', toConsumer: 'उपभोक्ता डैशबोर्ड पर जाएँ', consumerView: 'उपभोक्ता', providerView: 'प्रदाता' },
};

const KEY = 'parkmate.lang.v1';

export function loadLanguage() {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored && MENU_TEXT[stored] ? stored : 'en';
  } catch {
    return 'en';
  }
}

export function saveLanguage(lang) {
  try { window.localStorage.setItem(KEY, lang); } catch { /* preference simply isn't remembered */ }
}
