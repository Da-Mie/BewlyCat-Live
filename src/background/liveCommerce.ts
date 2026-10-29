import type { LiveClientRequest, LiveOffer, LiveOffers, LivePurchaseResult, LiveQuote, LiveSession } from '~/constants/liveClient'
import { liveAssetUrl } from '~/utils/liveRoom'

interface Dependencies {
  get: (path: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<any>
  post: (path: string, params: Record<string, unknown>, uid: string, signal: AbortSignal) => Promise<any>
  session: () => Promise<LiveSession>
}
interface Offer extends LiveOffer { giftId: number, goodsId: number, level: number, configId: number }
interface Catalog extends Pick<LiveOffers, 'roomId' | 'anchor' | 'scError'> { offers: Offer[], ruid: string, area: number, parentArea: number }
interface Quote { view: LiveQuote, offer: Offer, uid: string, scope: string, ruid: string }

export function createLiveCommerce(api: Dependencies) {
  const quotes = new Map<string, Quote>()
  const paying = new Set<string>()

  async function checkAccount(uid?: string) {
    if (!uid || uid === '0' || (await api.session()).uid !== uid)
      throw new Error('请先登录，账号切换后请重新打开礼物面板。')
    return uid
  }
  async function giftCatalog(roomId: string, signal: AbortSignal) {
    const details = await api.get('/xlive/web-room/v1/index/getInfoByRoom', { room_id: roomId }, signal)
    const info = details.room_info
    if (!info?.uid || !info.room_id || info.live_status !== 1 || info.lock_status || info.hidden_status)
      throw new Error('此直播间暂时无法送礼。')
    const params = { room_id: info.room_id, ruid: info.uid, area_id: info.area_id, area_parent_id: info.parent_area_id, platform: 'pc', source: 'live', build: 0, base_version: 0 }
    const gifts = await api.get('/xlive/web-room/v1/giftPanel/roomGiftList', params, signal)
    return { details, info, gifts, config: [...(gifts.gift_config?.base_config?.list ?? []), ...(gifts.gift_config?.room_config ?? [])] }
  }
  async function catalog(roomId: string, signal: AbortSignal, includeSC = true): Promise<Catalog> {
    const { details, info, gifts, config } = await giftCatalog(roomId, signal)
    const byId = new Map<number, any>(config.map(item => [Number(item.id), item]))
    const offers: Offer[] = []
    for (const item of [...(gifts.gift_data?.room_gift_list?.gold_list ?? []), ...(gifts.gift_data?.room_gift_list?.silver_list ?? [])]) {
      const gift = byId.get(Number(item.gift_id))
      if (!gift || !Number.isSafeInteger(gift.id) || gift.id < 1 || (item.special?.is_use !== undefined && item.special.is_use !== 1)
        || (item.gift_scene?.pay_type && item.gift_scene.pay_type !== 'send_gift')
        || gift.goods_id !== 15 || gift.gift_type !== 0 || gift.draw || gift.privilege_required
        || !Number.isSafeInteger(gift.price) || gift.price <= 0 || !['gold', 'silver'].includes(gift.coin_type)) {
        continue
      }
      offers.push({ id: `gift:${gift.id}`, kind: 'gift', giftId: gift.id, goodsId: 15, level: 0, configId: 0, name: String(gift.name), image: liveAssetUrl(gift.img_basic), price: gift.price, currency: gift.coin_type, maxQuantity: Math.min(gift.max_send_limit || 1, gifts.gift_data.max_send_gift || 1, 5000), limit: 0 })
    }
    let scError = ''
    if (includeSC && details.super_chat_info?.status === 1) {
      try {
        const sc = await api.get('/av/v1/SuperChat/config', { room_id: info.room_id, ruid: info.uid, area_id: info.area_id, parent_area_id: info.parent_area_id }, signal)
        if (sc.user_ban_info?.limited)
          throw new Error(sc.user_ban_info.limited_tip || '当前账号暂不能发送 SC。')
        for (const item of sc.price_configs ?? []) {
          if (item.type_detail?.can_buy === false || !Number.isSafeInteger(item.price * 1000) || item.price <= 0 || !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.level) || !Number.isInteger(item.limit) || item.limit < 1)
            continue
          offers.push({ id: `sc:${item.id}`, kind: 'sc', giftId: Number(sc.gift_id), goodsId: Number(sc.goods_id) || 12, configId: item.id, level: item.level, name: 'SC', image: '', price: item.price * 1000, currency: 'gold', maxQuantity: 1, limit: Math.min(item.limit, 1000) })
        }
      }
      catch (error) {
        scError = error instanceof Error ? error.message : String(error)
      }
    }
    return { roomId: String(info.room_id), anchor: String(details.anchor_info?.base_info?.uname || info.uid), ruid: String(info.uid), area: info.area_id, parentArea: info.parent_area_id, offers: [...new Map(offers.map(offer => [offer.id, offer])).values()], scError }
  }
  function publicOffer(offer: Offer): LiveOffer {
    const { giftId: _giftId, goodsId: _goodsId, configId: _configId, level: _level, ...view } = offer
    return view
  }
  return async (request: LiveClientRequest, roomId: string, scope: string, signal: AbortSignal): Promise<LiveOffers | LiveQuote | LivePurchaseResult | Record<string, string>> => {
    if (request.action === 'giftAssets') {
      const { config } = await giftCatalog(roomId, signal)
      return Object.fromEntries(config.slice(0, 1000).map(item => [String(item.id), liveAssetUrl(item.webp || item.gif || item.img_basic)]))
    }
    for (const [token, quote] of quotes) {
      if (quote.view.expires < Date.now())
        quotes.delete(token)
    }
    const uid = await checkAccount(request.expectedUid)
    if (request.action === 'purchase') {
      const quote = quotes.get(request.quoteToken ?? '')
      if (!quote || quote.scope !== scope || quote.uid !== uid || quote.view.roomId !== roomId || quote.view.expires <= Date.now())
        throw new Error('确认信息已失效，请重新选择礼物。')
      if (paying.has(uid))
        throw new Error('上一笔发送正在处理，请稍候。')
      quotes.delete(quote.view.token)
      paying.add(uid)
      try {
        const latest = await catalog(roomId, signal, quote.offer.kind === 'sc')
        const item = latest.offers.find(item => item.id === quote.offer.id)
        if (!item || latest.ruid !== quote.ruid || item.price !== quote.offer.price || item.currency !== quote.offer.currency || item.configId !== quote.offer.configId || item.level !== quote.offer.level || item.goodsId !== quote.offer.goodsId || item.maxQuantity < quote.view.quantity || (item.kind === 'sc' && item.limit < quote.view.text.length))
          throw new Error('礼物或价格已更新，请重新确认。')
        await checkAccount(uid)
        if (quote.view.expires <= Date.now())
          throw new Error('确认信息已失效，请重新选择礼物。')
        signal.throwIfAborted()
        const data = item.kind === 'gift'
          ? await api.post(`/xlive/revenue/v2/gift/${item.currency === 'gold' ? 'sendGoldMultiUser' : 'sendSilverMultiUser'}`, {
              uid,
              gift_id: item.giftId,
              ruid: latest.ruid,
              send_ruid: latest.ruid,
              gift_num: quote.view.quantity,
              coin_type: item.currency,
              bag_id: 0,
              platform: 'pc',
              biz_code: 'Live',
              biz_id: latest.roomId,
              storm_beat_id: 0,
              metadata: '',
              price: item.price,
              receive_users: JSON.stringify([{ uid: Number(latest.ruid) }]),
              all_flag: 0,
            }, uid, signal)
          : await api.post('/xlive/revenue/v1/order/createOrder', {
              parent_area_id: latest.parentArea,
              area_id: latest.area,
              context_id: latest.roomId,
              context_type: 1,
              ruid: latest.ruid,
              goods_id: item.goodsId,
              goods_num: 1,
              mobile_app: 'web',
              platform: 'pc',
              pay_gold: quote.view.total,
              biz_extra: JSON.stringify({ msg: quote.view.text, level: item.level, trans_key: '', biz_id: item.configId, sc_image_id: 0 }),
            }, uid, signal)
        if (item.kind === 'gift')
          return { status: 'sent' }
        if (data?.status === 4)
          return { status: 'review' }
        if (data?.status === 5)
          return { status: 'sent' }
        if (data?.status === 2 && data?.order_id) {
          await api.get('/av/v1/SuperChat/getMessage', { order_id: data.order_id }, signal)
          return { status: 'sent' }
        }
        return { status: 'unknown' }
      }
      finally { paying.delete(uid) }
    }
    const value = await catalog(roomId, signal, request.action === 'offers' || request.offerId?.startsWith('sc:'))
    await checkAccount(uid)
    if (value.ruid === uid)
      throw new Error('不能向自己送礼。')
    if (request.action === 'offers')
      return { roomId: value.roomId, uid, anchor: value.anchor, offers: value.offers.map(publicOffer), scError: value.scError }
    const offer = value.offers.find(item => item.id === request.offerId)
    const quantity = request.quantity
    const text = String(request.text ?? '').trim()
    if (!offer || !Number.isSafeInteger(quantity) || quantity! < 1 || quantity! > offer.maxQuantity || (offer.kind === 'sc' && (!text || text.length > offer.limit || quantity !== 1)))
      throw new Error('请选择有效礼物、数量和留言。')
    const total = offer.price * quantity!
    if (!Number.isSafeInteger(total))
      throw new Error('金额无效。')
    const view: LiveQuote = { ...publicOffer(offer), token: crypto.randomUUID(), roomId: value.roomId, anchor: value.anchor, quantity: quantity!, total, text: offer.kind === 'sc' ? text : '', expires: Date.now() + 60_000 }
    for (const [token, old] of quotes) {
      if (old.scope === scope)
        quotes.delete(token)
    }
    if (quotes.size >= 32)
      quotes.delete(quotes.keys().next().value!)
    quotes.set(view.token, { view, offer, uid, scope, ruid: value.ruid })
    return view
  }
}
