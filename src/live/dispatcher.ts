interface Candidate<T> { value: T, started: boolean, ready: boolean, allowed: boolean }

export class LiveMessageDispatcher<T> {
  private queue: Candidate<T>[] = []
  private active = true
  private pending = 0

  constructor(private allow: (value: T) => Promise<boolean>, private deliver: (value: T) => void, private limit = 256) {}

  push(value: T) {
    if (!this.active)
      return
    if (this.queue.length >= this.limit)
      this.queue.shift()
    this.queue.push({ value, started: false, ready: false, allowed: false })
    this.pump()
  }

  private pump() {
    if (!this.active)
      return
    for (const entry of this.queue) {
      if (this.pending >= this.limit)
        break
      if (!entry.started) {
        entry.started = true
        this.pending++
        void this.check(entry)
      }
    }
  }

  private async check(entry: Candidate<T>) {
    try {
      entry.allowed = await this.allow(entry.value)
    }
    catch {
      entry.allowed = false
    }
    finally {
      entry.ready = true
      this.pending--
      this.flush()
      this.pump()
    }
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
    this.pump()
  }

  close() {
    this.active = false
    this.queue.length = 0
  }
}
