import { settings } from '~/logic'

export function getComponentConfig(componentKey: string) {
  return settings.value.topBarComponentsConfig?.find(item => item.key === componentKey)
}

export function isComponentVisible(componentKey: string): boolean {
  const config = getComponentConfig(componentKey)
  return config?.visible ?? true
}

export function getBadgeType(componentKey: string): 'number' | 'dot' | 'none' {
  const config = getComponentConfig(componentKey)
  return config?.badgeType || 'number'
}

export function shouldShowBadge(componentKey: string): boolean {
  const badgeType = getBadgeType(componentKey)
  const isVisible = isComponentVisible(componentKey)
  return isVisible && badgeType !== 'none'
}

export function shouldShowNumberBadge(componentKey: string): boolean {
  const badgeType = getBadgeType(componentKey)
  const isVisible = isComponentVisible(componentKey)
  return isVisible && badgeType === 'number'
}

export function shouldShowDotBadge(componentKey: string): boolean {
  const badgeType = getBadgeType(componentKey)
  const isVisible = isComponentVisible(componentKey)
  return isVisible && badgeType === 'dot'
}
