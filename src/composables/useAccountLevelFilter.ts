import { computed, shallowRef, watchEffect } from 'vue'

import { settings } from '~/logic'
import { lookupAccountIdentity } from '~/utils/accountIdentityLookup'
import type { AccountFilterDecision, AccountFilterScope, AccountIdentity } from '~/utils/accountLevelFilter'
import { AccountIdentityCache, decideAccountFilter, needsAccountIdentity, normalizeAccountMid } from '~/utils/accountLevelFilter'
import { getUserID } from '~/utils/main'

export const accountIdentityRevision = shallowRef(0)
export const accountIdentities = new AccountIdentityCache(lookupAccountIdentity, () => {
  accountIdentityRevision.value++
})

let identityAccount = normalizeAccountMid(getUserID())
function syncIdentityAccount() {
  const self = normalizeAccountMid(getUserID())
  if (self !== identityAccount) {
    identityAccount = self
    accountIdentities.reset()
  }
  return self
}

export function getAccountFilterDecision(identity: AccountIdentity, scope: AccountFilterScope, query = true): AccountFilterDecision {
  void accountIdentityRevision.value
  const filters = settings.value.accountLevelFilters
  const self = syncIdentityAccount()
  const cached = identity.mid ? accountIdentities.peek(identity.mid) : undefined
  const merged = { ...cached, ...Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== undefined)) }
  if (needsAccountIdentity(merged, filters, scope, self) && !cached) {
    if (query)
      void accountIdentities.resolve(identity.mid!)
    return 'pending'
  }
  return decideAccountFilter(merged, filters, scope, self)
}

export function useAccountLevelFilter(identity: () => AccountIdentity, scope: AccountFilterScope, active: () => boolean = () => true) {
  watchEffect(() => {
    if (active())
      getAccountFilterDecision(identity(), scope)
  })
  return computed(() => active() ? getAccountFilterDecision(identity(), scope, false) : 'allow')
}

/** Only public identity data crosses into MAIN; extension credentials never do. */
export function installAccountIdentityBridge() {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'BEWLY_ACCOUNT_LOOKUP')
      return
    const mid = normalizeAccountMid(event.data.mid)
    const id = event.data.id
    if (!mid || typeof id !== 'string' || !/^identity:\d+$/.test(id))
      return
    syncIdentityAccount()
    if (!Object.values(settings.value.accountLevelFilters).some(value => typeof value === 'object' && value && 'enabled' in value && value.enabled))
      return
    void accountIdentities.resolve(mid).then(identity => window.postMessage({ type: 'BEWLY_ACCOUNT_RESULT', id, identity }, location.origin))
  })
}
