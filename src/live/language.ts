import { LanguageType } from '~/enums/appEnums'

const documentLanguages = {
  [LanguageType.English]: 'en',
  [LanguageType.Mandarin_CN]: 'zh-CN',
  [LanguageType.Mandarin_TW]: 'zh-TW',
  [LanguageType.Cantonese]: 'zh-HK',
}

export function resolveLiveLanguage(saved: string, browserLanguage: string) {
  let locale = saved as LanguageType
  if (!Object.hasOwn(documentLanguages, locale)) {
    const language = browserLanguage.toLowerCase().replaceAll('_', '-')
    if (language.startsWith('yue') || /^zh-(?:hk|mo)/.test(language))
      locale = LanguageType.Cantonese
    else if (/^zh-(?:tw|hant)/.test(language))
      locale = LanguageType.Mandarin_TW
    else if (language.startsWith('zh'))
      locale = LanguageType.Mandarin_CN
    else
      locale = LanguageType.English
  }
  return { locale, lang: documentLanguages[locale] }
}
