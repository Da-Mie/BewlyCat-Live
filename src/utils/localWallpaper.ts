/** 本地壁纸管理工具 将图片base64存储在本地storage的单独项中，设置里只保存引用 */

import { useStorageLocal } from '~/composables/useStorageLocal'

// 本地壁纸数据接口
export interface LocalWallpaperData {
  id: string
  name: string
  base64: string
  size: number
  type: string
  lastModified: number
  timestamp: number
}

// 本地壁纸引用接口
export interface LocalWallpaperRef {
  id: string
  name: string
  isLocal: true
}

let localWallpapersReadFailed = false
let resolveLocalWallpapersLoaded: (loaded: boolean) => void = () => {}
/** 本地壁纸首次读取结束后兑现，结果表示数据是否可信。读取完成前 getLocalWallpaper / hasLocalWallpaper 都会返回“不存在”，据此清理引用的逻辑必须先等待它。 */
export const localWallpapersLoaded = new Promise<boolean>((resolve) => {
  resolveLocalWallpapersLoaded = resolve
})

// 本地壁纸存储
const localWallpapers = useStorageLocal<Record<string, LocalWallpaperData>>('localWallpapers', {}, {
  onError: (error) => {
    // 读取或补写默认值失败时数据不可信，宁可跳过清理也不误删引用。
    localWallpapersReadFailed = true
    console.error(error)
  },
  onReady: () => resolveLocalWallpapersLoaded(!localWallpapersReadFailed),
})

export function generateWallpaperId(fileName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const extension = fileName.split('.').pop() || ''
  return `wallpaper_${timestamp}_${random}.${extension}`
}

export async function storeLocalWallpaper(file: File, base64: string): Promise<LocalWallpaperRef> {
  const id = generateWallpaperId(file.name)

  const wallpaperData: LocalWallpaperData = {
    id,
    name: file.name,
    base64,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    timestamp: Date.now(),
  }

  // 存储到本地storage
  const currentWallpapers = localWallpapers.value || {}
  currentWallpapers[id] = wallpaperData
  localWallpapers.value = currentWallpapers

  // 返回引用对象
  return {
    id,
    name: file.name,
    isLocal: true,
  }
}

export function getLocalWallpaper(id: string): string | null {
  const wallpapers = localWallpapers.value || {}
  const wallpaper = wallpapers[id]

  if (wallpaper) {
    return wallpaper.base64
  }

  return null
}

/**
 * 删除本地壁纸
 * @param id 壁纸ID
 */
export function removeLocalWallpaper(id: string): void {
  const currentWallpapers = localWallpapers.value || {}

  if (currentWallpapers[id]) {
    delete currentWallpapers[id]
    localWallpapers.value = currentWallpapers
  }
}

export function hasLocalWallpaper(id: string): boolean {
  const wallpapers = localWallpapers.value || {}
  return !!wallpapers[id]
}

/**
 * 获取所有本地壁纸的信息
 * @returns 壁纸信息数组
 */
export function getAllLocalWallpapers(): LocalWallpaperData[] {
  const wallpapers = localWallpapers.value || {}
  return Object.values(wallpapers)
}

/** 清理所有本地壁纸 */
export function clearAllLocalWallpapers(): void {
  localWallpapers.value = {}
}

/** 解析 local-wallpaper:id，普通 URL 原样返回。 */
export function resolveWallpaperUrl(url: string): string | null {
  if (!url)
    return null

  // 如果是本地壁纸引用格式
  if (url.startsWith('local-wallpaper:')) {
    const id = url.replace('local-wallpaper:', '')
    return getLocalWallpaper(id)
  }

  // 普通URL直接返回
  return url
}

export function isLocalWallpaperUrl(url: string): boolean {
  return url.startsWith('local-wallpaper:')
}

export function extractWallpaperId(url: string): string | null {
  if (isLocalWallpaperUrl(url)) {
    return url.replace('local-wallpaper:', '')
  }
  return null
}
