import type { LiveChatAuth } from '~/constants/liveClient'

import { decodeLivePackets, encodeLivePacket } from './protocol'

export type LiveChatState = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'

export class LiveChatConnection {
  private socket?: WebSocket
  private heartbeat?: ReturnType<typeof setInterval>
  private timeout?: ReturnType<typeof setTimeout>
  private retry?: ReturnType<typeof setTimeout>
  private active = true
  private attempts = 0
  private generation = 0
  private lastPacket = 0

  constructor(
    private roomId: string,
    private getAuth: () => Promise<LiveChatAuth>,
    private onMessage: (data: any) => void,
    private onState: (state: LiveChatState, error?: string) => void,
  ) {}

  async start() {
    const generation = ++this.generation
    this.onState(this.attempts ? 'reconnecting' : 'connecting')
    try {
      const auth = await this.getAuth()
      if (!this.active || generation !== this.generation)
        return
      const server = auth.servers[this.attempts % auth.servers.length]
      const url = new URL(server)
      if (url.protocol !== 'wss:' || !url.hostname.endsWith('.chat.bilibili.com') || url.pathname !== '/sub')
        throw new Error('Invalid live chat server')
      const socket = this.socket = new WebSocket(url)
      socket.binaryType = 'arraybuffer'
      this.lastPacket = Date.now()
      let decoding = Promise.resolve()
      this.timeout = setTimeout(() => this.reconnect(generation), 12000)
      socket.onopen = () => socket.send(encodeLivePacket(7, {
        uid: Number(auth.uid) || 0,
        roomid: Number(this.roomId),
        protover: 3,
        platform: 'web',
        type: 2,
        key: auth.token,
        buvid: auth.buvid,
      }))
      socket.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer))
          return
        this.lastPacket = Date.now()
        decoding = decoding.then(async () => {
          const packets = await decodeLivePackets(new Uint8Array(event.data))
          if (!this.active || generation !== this.generation)
            return
          for (const packet of packets) {
            if (packet.operation === 8) {
              if (packet.data.code !== 0) {
                this.reconnect(generation)
                return
              }
              clearTimeout(this.timeout)
              this.attempts = 0
              this.onState('connected')
              socket.send(encodeLivePacket(2, '[object Object]'))
              clearInterval(this.heartbeat)
              this.heartbeat = setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN || Date.now() - this.lastPacket > 75000)
                  this.reconnect(generation)
                else
                  socket.send(encodeLivePacket(2, '[object Object]'))
              }, 30000)
            }
            else if (packet.operation === 5) {
              // Filtering/UI have their own queue and cannot delay authentication or heartbeat.
              this.onMessage(packet.data)
            }
          }
        }).catch(() => this.reconnect(generation))
      }
      socket.onerror = () => this.reconnect(generation)
      socket.onclose = () => this.reconnect(generation)
    }
    catch (error) {
      if (!this.active || generation !== this.generation)
        return
      // API authentication/risk errors require user action; do not hammer the endpoint.
      this.onState('error', error instanceof Error ? error.message : String(error))
    }
  }

  private reconnect(generation: number) {
    if (!this.active || generation !== this.generation)
      return
    this.generation++
    this.clearSocket()
    this.attempts++
    if (this.attempts > 8) {
      this.onState('error', 'Live chat disconnected')
      return
    }
    this.onState('reconnecting')
    this.retry = setTimeout(() => void this.start(), Math.min(30000, 1000 * 2 ** (this.attempts - 1)))
  }

  private clearSocket() {
    clearTimeout(this.timeout)
    clearInterval(this.heartbeat)
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null
      this.socket.close()
      this.socket = undefined
    }
  }

  close() {
    this.active = false
    this.generation++
    clearTimeout(this.retry)
    this.clearSocket()
    this.onState('closed')
  }
}
