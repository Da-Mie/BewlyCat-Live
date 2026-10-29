import browser from 'webextension-polyfill'

export interface BrowserInfo {
  name: string | null
  version: string | null
}

export const GET_BROWSER_INFO_MESSAGE = 'getBrowserInfo'

interface UserAgentBrandVersion {
  brand: string
  version: string
}

interface NavigatorUserAgentData {
  brands: UserAgentBrandVersion[]
  getHighEntropyValues?: (hints: string[]) => Promise<{
    fullVersionList?: UserAgentBrandVersion[]
  }>
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: NavigatorUserAgentData
}

const browserMatchers: Array<{
  name: string
  pattern: RegExp
}> = [
  { name: 'Microsoft Edge', pattern: /Edg(?:A|iOS)?\/([\d.]+)/i },
  { name: 'Opera', pattern: /(?:OPR|Opera|OPiOS)[/ ]([\d.]+)/i },
  { name: 'Samsung Internet', pattern: /SamsungBrowser\/([\d.]+)/i },
  { name: 'Vivaldi', pattern: /Vivaldi\/([\d.]+)/i },
  { name: 'Yandex Browser', pattern: /YaBrowser\/([\d.]+)/i },
  { name: 'Firefox', pattern: /(?:Firefox|FxiOS)\/([\d.]+)/i },
  { name: 'Google Chrome', pattern: /(?:Chrome|CriOS)\/([\d.]+)/i },
  { name: 'Apple Safari', pattern: /Version\/([\d.]+)\s[^\r\n]*Safari/i },
  { name: 'Chromium', pattern: /Chromium\/([\d.]+)/i },
]

function normalizeBrandName(brand: string): string | null {
  const normalizedBrand = brand.toLowerCase()

  if (normalizedBrand.includes('microsoft edge'))
    return 'Microsoft Edge'
  if (normalizedBrand.includes('google chrome'))
    return 'Google Chrome'
  if (normalizedBrand.includes('opera'))
    return 'Opera'
  if (normalizedBrand === 'chromium')
    return 'Chromium'

  return null
}

function selectMoreSpecificVersion(currentVersion: string | null, candidateVersion: string) {
  if (!currentVersion)
    return candidateVersion

  const currentParts = currentVersion.split('.').length
  const candidateParts = candidateVersion.split('.').length
  return candidateParts > currentParts ? candidateVersion : currentVersion
}

export function parseBrowserInfo(userAgent = navigator.userAgent): BrowserInfo {
  for (const { name, pattern } of browserMatchers) {
    const match = userAgent.match(pattern)
    if (match)
      return { name, version: match[1] }
  }

  return { name: null, version: null }
}

export async function getBrowserInfo(): Promise<BrowserInfo> {
  const fallbackInfo = parseBrowserInfo()
  const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData

  if (!userAgentData)
    return fallbackInfo

  let brands = userAgentData.brands
  let hasFullVersionList = false

  try {
    const highEntropyValues = await userAgentData.getHighEntropyValues?.(['fullVersionList'])
    if (highEntropyValues?.fullVersionList?.length) {
      brands = highEntropyValues.fullVersionList
      hasFullVersionList = true
    }
  }
  catch {
    // The regular user agent and low-entropy brands remain usable as fallbacks.
  }

  const matchingBrand = brands.find(({ brand }) => normalizeBrandName(brand) === fallbackInfo.name)
  if (matchingBrand) {
    return {
      name: fallbackInfo.name,
      version: hasFullVersionList
        ? matchingBrand.version
        : selectMoreSpecificVersion(fallbackInfo.version, matchingBrand.version),
    }
  }

  if (fallbackInfo.name)
    return fallbackInfo

  const recognizedBrand = brands.find(({ brand }) => normalizeBrandName(brand))
  return recognizedBrand
    ? { name: normalizeBrandName(recognizedBrand.brand), version: recognizedBrand.version }
    : fallbackInfo
}

/** MAIN 可能改写 UA；后台优先用 Firefox runtime.getBrowserInfo 判断浏览器。 */
export async function getExtensionBrowserInfo(): Promise<BrowserInfo> {
  try {
    const runtimeInfo = await browser.runtime.getBrowserInfo?.()
    if (runtimeInfo?.name)
      return { name: runtimeInfo.name, version: runtimeInfo.version || null }
  }
  catch {
    // Chromium 不提供该 API，回退到 UA 与 Client Hints。
  }

  return getBrowserInfo()
}
