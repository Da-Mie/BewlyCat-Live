import { readAccountIdentity } from './accountLevelFilter'
import api from './api'

export async function lookupAccountIdentity(mid: string) {
  const result = await api.user.getUserCard({ mid }, { signal: AbortSignal.timeout(4000) })
  if (result?.code !== 0 || !result.data?.card)
    throw new Error('Account identity unavailable')
  return { ...readAccountIdentity(result.data.card), followed: typeof result.data.following === 'boolean' ? result.data.following : undefined }
}
