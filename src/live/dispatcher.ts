export class LiveMessageDispatcher<T> {
  private queue: { value: T, ready: boolean, allowed: boolean }[] = []
  private active = true

  constructor(private allow: (value: T) => Promise<boolean>, private deliver: (value: T) => void, private limit = 256) {}

  push(value: T) {
    if (!this.active)
      return
    const entry = { value, ready: false, allowed: false }
    if (this.queue.length >= this.limit)
      this.queue.shift()
    this.queue.push(entry)
    void this.allow(value).then((allowed) => {
      entry.allowed = allowed
    }).catch(() => {
      entry.allowed = false
    }).finally(() => {
      entry.ready = true
      this.flush()
    })
  }

  private flush() {
    while (this.active && this.queue[0]?.ready) {
      const entry = this.queue.shift()!
      if (entry.allowed)
        this.deliver(entry.value)
    }
  }

  remove(match: (value: T) => boolean) {
    this.queue = this.queue.filter(entry => !match(entry.value))
    this.flush()
  }

  close() {
    this.active = false
    this.queue.length = 0
  }
}
