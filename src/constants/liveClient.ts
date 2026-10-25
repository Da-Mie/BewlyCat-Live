export const LIVE_CLIENT_REQUEST = 'bewly-cat:live-client:request'
export const LIVE_CLIENT_OPEN = 'bewly-cat:live-client:open'
export const LIVE_CLIENT_PAGE = 'dist/live/index.html'

export type LiveClientAction = 'room' | 'chat' | 'history' | 'session' | 'filters' | 'send' | 'offers' | 'quote' | 'purchase' | 'giftAssets'
export interface LiveClientRequest {
  action: LiveClientAction
  roomId?: string
  quality?: number
  text?: string
  expectedUid?: string
  offerId?: string
  quantity?: number
  quoteToken?: string
}
export interface LiveSession { uid: string, buvid: string }
export interface LiveChatAuth extends LiveSession { token: string, servers: string[] }

export interface LiveOffer {
  id: string
  kind: 'gift' | 'sc'
  name: string
  image: string
  price: number
  currency: 'gold' | 'silver'
  maxQuantity: number
  limit: number
}
export interface LiveOffers { roomId: string, uid: string, anchor: string, offers: LiveOffer[], scError: string }
export interface LiveQuote extends LiveOffer { token: string, roomId: string, anchor: string, quantity: number, total: number, text: string, expires: number }
export interface LivePurchaseResult { status: 'sent' | 'review' | 'unknown' }
