import ExtPay from 'extpay'
import {
  EventStreamContentType,
  EventSourceMessage,
  FetchEventSourceInit,
  fetchEventSource,
} from '@microsoft/fetch-event-source'

import { APPLICATION_JSON, BASE_URL } from './api'
import {
  Message,
  MessageType,
  PaymentStatus,
  PaymentStatusType,
  Settings,
  SseEvent,
  initialTrialUsageLimit,
  mustActivateTrialOrPayErrorMessage,
  mustPayErrorMessage,
} from './data';
import { isChrome } from './utils'

import browser from 'webextension-polyfill'
import log from './log'

// TODO move this to an env file or something.
// FYI it's also used in `manifest.json`.
// const EXTPAY_EXTENSION_ID = 'dkuvofduqgcezwnmbdhqsbrufvynpeqkdkga'
const EXTPAY_EXTENSION_ID = 'youtube-video-summarizer'

const ON_UNINSTALL_POPUP_URL = 'https://magicboxpremium.com/extension/yt/delete.html'

const TAG = 'background'
const manifest = browser.runtime.getManifest()

// Server worker `document` is undefined,
// but `fetchEventSource` need it,
// so we mock it.
if (isChrome()) {
  // @ts-ignore
  global.document = {
    hidden: false,

    // @ts-ignore
    addEventListener: (type, listener, options) => {
      try {
        global.addEventListener(type, listener, options)
      } catch (e) {
        log(TAG, `addEventListener, catch, type=${type}, e=${e}`)
        // DO NOTHING.
      }
    },

    // @ts-ignore
    removeEventListener: (type, listener, options) => {
      try {
        global.removeEventListener(type, listener, options)
      } catch (e) {
        log(TAG, `removeEventListener, catch, type=${type}, e=${e}`)
        // DO NOTHING.
      }
    },
  }
}

// Server worker `document` is undefined,
// but `fetchEventSource` need it,
// so we mock it.
if (isChrome()) {
  global.window = {
    // @ts-ignore
    setTimeout: (callback, ms, ...args) => {
      try {
        global.setTimeout(callback, ms, args)
      } catch (e) {
        log(TAG, `setTimeout catch, e=${e}`)
        // DO NOTHING.
      }
    },

    clearTimeout: timeoutId => {
      try {
        global.clearTimeout(timeoutId)
      } catch (e) {
        log(TAG, `clearTimeout catch, e=${e}`)
        // DO NOTHING.
      }
    },
  }
}

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === (browser.runtime as any).OnInstalledReason.INSTALL) {
    browser.tabs.create({
      url: "https://magicboxpremium.com/extension/yt/index.html",
    });

    browser.runtime.setUninstallURL(ON_UNINSTALL_POPUP_URL);
  }
});

const extpay = ExtPay(EXTPAY_EXTENSION_ID)
extpay.startBackground()
let paymentStatus: PaymentStatus | undefined
// TODO handle the fact that this async function could be called
// several times... Or idk, just think and make sure it's fine.
tryUpdatePaymentStatus(null)

// https://github.com/Azure/fetch-event-source
class FatalError extends Error { /* DO NOTHING. */ }
class RetriableError extends Error { /* DO NOTHING. */ }

const throwInvalidSender = (send: (message?: any) => void, senderId?: string) => {
  const msg = `invalid sender, senderId=${senderId}`
  log(TAG, msg)
  send({
    type: MessageType.ERROR,
    error: new Error(msg),
  } as Message)
}

const throwInvalidRequest = (send: (message?: any) => void, message: Message) => {
  const msg = `invalid request, message=${JSON.stringify(message)}`
  log(TAG, msg)
  send({
    type: MessageType.ERROR,
    error: new Error(msg),
  } as Message)
}

const getOpenAiApiKey = async (): Promise<string> => {
  const res = await browser.storage.sync.get(Settings.OPENAI_API_KEY)
  const { [Settings.OPENAI_API_KEY]: key }: { [Settings.OPENAI_API_KEY]?: string } = res
  return key ? key.trim() : ''
}

const getUid = async (): Promise<string> => {
  const res = await browser.storage.sync.get(Settings.UID)
  const { [Settings.UID]: uid }: { [Settings.UID]?: string } = res
  return uid ? uid.trim() : ''
}

const getOrGenerateUid = async (): Promise<string> => {
  const savedUid = await getUid()
  if (savedUid) return savedUid

  const res = await fetch(`${BASE_URL}/api/user`, { method: 'POST' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }

  const json = await res.json()
  const { uid }: { uid?: string } = json

  const finalUid = uid ? uid.trim() : ''
  if (!finalUid || finalUid.length <= 0) {
    throw new Error('generate uid from server failed')
  }

  await browser.storage.sync.set({ [Settings.UID]: finalUid })
  return finalUid
}

browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  log(TAG, `runtime, onMessage, senderId=${sender.id}`)

  // Filter our extension messages.
  if (sender.id !== browser.runtime.id) {
    throwInvalidSender(sendResponse, sender.id)
    return true
  }

  const { type, requestUrl, requestInit = {} } = message
  log(TAG, `runtime, onMessage, requestUrl=${requestUrl}`)

  // This message is handled in a different
  // `browser.runtime.onMessage.addListener`
  // TODO refactor: would be nice not having a special case for it here I guess,
  // just ignoring this message instead.
  // Or having just one `onMessage` handler.
  if (type === MessageType.EMAIL_REQUEST) {
    return
  }

  // 'chrome-extension://' or 'moz-extension://'
  if (type === MessageType.OPEN_TAB) {
    browser.tabs.create({ url: requestUrl })
    return
  }

  // Must be MessageType.REQUEST
  if (type !== MessageType.REQUEST || !requestUrl) {
    throwInvalidRequest(sendResponse, message)
    return true
  }

  // TODO fix: perhaps we also need to check payment status here.
  // But no real need since this is used just for translations.
  // Ideally we want authentication everywhere `getOpenAiApiKey` is used.
  //
  // TODO refactor: but in this code it's not obvious that it's only used for
  // translations.

  Promise.all([getOrGenerateUid(), getOpenAiApiKey()])
    .then(([uid, key]) => {
      const { headers = {} } = requestInit || {}
      return {
        ...requestInit,
        headers: {
          ...headers,
          'uid': uid,
          'openai-api-key': key, // don't use underscore here because of nginx.
          'browser': isChrome() ? 'chrome' : 'firefox',
          'ext-version': manifest.version,
        }
      }
    })
    .then(init => fetch(requestUrl, init))
    .then(async (response: Response) => { // response can't be stringify.
      const json = await response.json()
      log(TAG, `fetch, then, ok=${response.ok}, json=${JSON.stringify(json)}`)

      // @ts-ignore
      sendResponse({
        type: MessageType.RESPONSE,
        responseOk: response.ok,
        responseJson: json,
      } as Message)
    })
    .catch((error: Error) => { // error can't be stringify.
      log(TAG, `fetch, catch, error=${error}`)

      // @ts-ignore
      sendResponse({
        type: MessageType.ERROR,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      } as Message)
    })

  // https://stackoverflow.com/q/48107746
  return true
})

browser.runtime.onConnect.addListener(port => {
  port.onMessage.addListener((message, port) => {
    const { name, sender: { id: senderId } = {} } = port
    log(TAG, `port, onMessage, port=${name}`)

    // Filter our extension messages.
    if (senderId !== browser.runtime.id) {
      throwInvalidSender(port.postMessage, senderId)
      return true
    }

    // Must be MessageType.REQUEST
    const { type, requestUrl, requestInit = {} } = message
    if (type !== MessageType.REQUEST || !requestUrl) {
      throwInvalidRequest(port.postMessage, message)
      return true
    }

    // TODO refactor: Promise<boolean> better?
    /**
     * @throws If we're not good to proceed with the request. If all is alright,
     *    then simply returns `void`.
     */
    async function doPaymentStuff(): Promise<void> {
      let reChecked = false
      while (true) {
        // Let's handle all the `return true` first.
        if (paymentStatus?.type === PaymentStatusType.PAID) {
          // Let's not re-check the actual payment status with the server here.
          // Because the state doesn't often switch from PAID to "not paid".
          // We'll refresh the info on browser restart,
          // or TODO setTimeout (an alarm, to be precise, because the background
          // script is not persistent.
          return
        }
        if (
          paymentStatus?.type === PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED
          // Can't check `paymentStatus.usesLeft > 0` here because that info
          // needs to be refreshed.
          // TODO refactor: then what the hell do we need the
          // `paymentStatus.usesLeft` variable for? We never read it.
        ) {
          // We could `tryUpdatePaymentStatus` here for fewer LOC,
          // but that also performs a network request.
          const storage = await browser.storage.sync.get(Settings.PAYMENT_STATUS)
          const {
            [Settings.PAYMENT_STATUS]: paymentStatusFromStorage
          }: { [Settings.PAYMENT_STATUS]?: PaymentStatus } = storage
          if (
            paymentStatusFromStorage?.type === PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED && // This check is redundant (unless there is a bug)
            paymentStatusFromStorage.usesLeft > 0
          ) {
            return
          }
          // TODO fix: maybe `tryUpdatePaymentStatus()` here in case
          // the user paid before spending the trial usages, so that
          // they don't see the x/5 counter.
        }

        // The fact that we reached this code means that we're not good
        // proceed, to serve the user.

        if (!reChecked) {
          // Let's re-check though.
          await tryUpdatePaymentStatus(() => getUserEmailFromPage(port))
          reChecked = true
          continue
        }
        // Ehh, we already tried re-checking the payment status with the
        // server, and we're still not in a proceed-able state.
        // FYI despite the below code being inside a loop, it should only get
        // executed once per this function's invocation.

        // Keep in mind that `tryUpdatePaymentStatus` might encounter an error
        // and fail to update `paymentStatus`, without throwing.
        // TODO refactor: this begs for a refactor?

        // Currently the below errors are to be displayed on the front-end,
        // to the user. TODO improvement: it's probably better to handle
        // the current payment state there on the front-end (i.e. content script).
        // Especially since the errors don't go away once the user does pay.
        if (paymentStatus == undefined) {
          // Could not fetch the payment status.
          // TODO improve message, i18n??
          throw new Error('Could not reach the payment server. Check internet connection')
        }
        if (paymentStatus.type === PaymentStatusType.NOT_PAID_BUT_CAN_TRY_TO_REQUEST_TRIAL) {
          // TODO i18n
          extpay.openTrialPage('5 summaries')
          // TODO impove error.
          throw new Error(mustActivateTrialOrPayErrorMessage)
        }
        if (paymentStatus.type === PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED) {
          // This means that no trial usages are left
          extpay.openPaymentPage()
          prepareToRespondToEmailRequestFromExtensionpay(
            getUserEmailFromPage(port)
          )
          // TODO improvement: also utilize `extpay.openLoginPage()`?
          throw new Error(mustPayErrorMessage)
        }
        // This should never happen
        throw Error('Failed to check payment status')
        break;
      }
    }


    // https://developer.mozilla.org/en-US/docs/Web/API/AbortController
    const ctrl = new AbortController()

    // https://github.com/Azure/fetch-event-source
    const sseInit: FetchEventSourceInit = {
      openWhenHidden: true,
      signal: ctrl.signal,
      fetch: fetch,

      async onopen(response: Response) {
        const { ok, headers, status } = response
        const contentType = headers.get('Content-Type')
        if (ok) {
          if (contentType === EventStreamContentType) {
            return // continue to onmessage, onclose or onerror.
          } else if (contentType === APPLICATION_JSON) {
            const json = await response.json()
            log(TAG, `sse, onopen, json=${JSON.stringify(json)}`)

            port.postMessage({
              type: MessageType.RESPONSE,
              responseOk: ok,
              responseJson: json,
            } as Message)

            ctrl.abort() // finished.
            return
          } else {
            const msg = `sse, onopen, invalid response, contentType=${contentType}`
            throw new FatalError(msg)
          }
        } else if (status >= 400 && status < 500 && status !== 429) {
          const text = await response.text()
          const msg = `sse, onopen, invalid response, text=${text}`
          throw new FatalError(msg)
        } else {
          const text = await response.text()
          const msg = `sse, onopen, invalid response, text=${text}`
          throw new RetriableError(msg)
        }
      },

      onerror(error: Error) { // error can't be stringify.
        log(TAG, `sse, onerror, port=${name}, error=${error}`)

        // If this callback is not specified, or it returns undefined,
        // will treat every error as retriable and will try again after 1 second.
        if (error instanceof RetriableError) return

        port.postMessage({
          type: MessageType.ERROR,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        } as Message)

        // If the error is fatal,
        // rethrow the error inside the callback to stop the entire operation.
        throw error
      },

      onclose() {
        log(TAG, `sse, onclose, port=${name}`)
        // DO NOTHING.
      },

      onmessage(event: EventSourceMessage) {
        try {
          const { event: sseEvent, data } = event
          const sseData = JSON.parse(data)
          log(TAG, `sse, onmessage, port=${name}, event=${sseEvent}, data=${data}`)

          switch (sseEvent) {
            case SseEvent.SUMMARY:
              port.postMessage({
                type: MessageType.SSE,
                sseEvent,
                sseData,
              } as Message)
              break
            case SseEvent.CLOSE:
            default:
              // DO NOTHING.
              break
          }
        } catch (e) {
          log(TAG, `see, onmessage, port=${name}, error=${e}`)
          // DO NOTHING.
        }
      },
    }

    const doPaymentStuffP = doPaymentStuff()
    const uidP = getOrGenerateUid()
    const openAiApiKeyP = getOpenAiApiKey()
    ;(async () => {
      try {
        await doPaymentStuffP
      } catch (error) {
        if (!(error instanceof Error)) throw error

        port.postMessage({
          type: MessageType.ERROR,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        } as Message)
        log(TAG, `not sending request because of payment status, port=${name}, error=${error}, paymentStatus=${JSON.stringify(paymentStatus)}`)
        return
      }

      const { headers = {} } = requestInit || {}
      const init = {
        ...requestInit,
        headers: {
          ...headers,
          'uid': await uidP,
          'openai-api-key': await openAiApiKeyP, // don't use underscore here because of nginx.
          'browser': isChrome() ? 'chrome' : 'firefox',
          'ext-version': manifest.version,
        },
        ...sseInit,
      }
      await fetchEventSource(requestUrl, init)
    })()
      .catch(error => {
        log(TAG, `sse, catch but ignore, error=${error}`)
        // DO NOTHING.
      })

    return true
  })
})

/**
 * Fetches the actual payment status from the extensionpay.com server,
 * saves it to storage and updates the `paymentStatus` variable.
 *
 * If there is an error, keeps the `paymentStatus` variable as is.
 */
async function tryUpdatePaymentStatus(
  getUserEmailFromPage: null | (() => Promise<GetUserEmailFromPageResult>),
): Promise<void> {
  const actualPaymentStatusP = _fetchPaymentStatus(getUserEmailFromPage)
  let actualPaymentStatus
  try {
    actualPaymentStatus = await actualPaymentStatusP
  } catch (e) {
    // Simply keep the status as is.
    // TODO think if it's a good strategy. What if their server is down?
    log(TAG, `failed to fetch paymentStatus keeping the cache as is, error=${e}`)
    return
  }

  log(TAG, `updating paymentStatus, paymentStatus=${JSON.stringify(actualPaymentStatus)}`)
  paymentStatus = actualPaymentStatus
  // TODO fix: since `_fetchPaymentStatus` is async, it might so happen that
  // let's say the `usesLeft` counter got updated while the
  // `_fetchPaymentStatus` was in progress.
  // We need to make sure not to override fresher data.
  browser.storage.sync.set({
    [Settings.PAYMENT_STATUS]: actualPaymentStatus
  })
}

/**
 * @throws on network error, or if the server returns invalid data for
 *    whatever reason.
 */
async function _fetchPaymentStatus(
  getUserEmailFromPage: null | (() => Promise<GetUserEmailFromPageResult>),
): Promise<PaymentStatus> {
  const extpayUserP = extpay.getUser();
  const storageP = browser.storage.sync.get(Settings.PAYMENT_STATUS)

  const extpayUser = await extpayUserP;
  log(TAG, `fetched extpay user, user=${JSON.stringify(extpayUser)}`)

  if (extpayUser.paid) {
    return { type: PaymentStatusType.PAID }
  }
  // Now, since the status is not `paid`, we can only return
  // either `NOT_PAID_BUT_TRIAL_ALREADY_STARTED` or
  // `NOT_PAID_BUT_CAN_TRY_TO_REQUEST_TRIAL`. Keep this in mind when reading
  // the below code.

  const {
    [Settings.PAYMENT_STATUS]: paymentStatusFromStorage
  }: { [Settings.PAYMENT_STATUS]?: PaymentStatus } = await storageP
  // Assert, prior to the next two checks.
  {const _dummy1: true = !extpayUser.paid;}
  if (
    paymentStatusFromStorage?.type ===
    PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED
  ) {
    // Keep unchanged
    return paymentStatusFromStorage
  }
  if (paymentStatusFromStorage?.type === PaymentStatusType.PAID) {
    // Used to be paid, but now the subscription expired.
    // They've already tried it, so no trial!
    return {
      type: PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED,
      usesLeft: 0
    }
  }
  // IDK why it says that the last part is `boolean` and not `true`,
  // but you got the point.
  // {const _dummy2: true =
  //   paymentStatusFromStorage === undefined ||
  //   paymentStatusFromStorage.type ===
  //     PaymentStatusType.NOT_PAID_BUT_CAN_TRY_TO_REQUEST_TRIAL;}

  // `extpayUser.email` might be present when the user is not logged in to
  // YouTube. We'll `extpay.openTrialPage()` for them where they'll enter it.
  const email =
    (extpayUser as any).email as string | null ||
    await getUserEmailFromPage?.()
      .then((r) => (r.type === "found" ? r.email : null))
      .catch(() => null);

  const haveEmail = Boolean(email);
  const haveDataToRequestTrial = haveEmail;
  if (!haveDataToRequestTrial) {
    return { type: PaymentStatusType.NOT_PAID_BUT_CAN_TRY_TO_REQUEST_TRIAL }
  }

  const res = await fetch(`${BASE_URL}/api/request_trial`, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
    })
  })
  const resJson = (await res.json())
  log(TAG, `Trial request response from server: ${JSON.stringify(resJson)}`)
  const trialGrantedVal = resJson.granted
  if (typeof trialGrantedVal !== 'boolean') {
    // Uh-oh, wrong format? This shouldn't really happen.
    // The trial has not been granted, but neither has it been rejected IDK.
    log(TAG, 'Warn: invalid response from server to a trial request?')
    return { type: PaymentStatusType.NOT_PAID_BUT_CAN_TRY_TO_REQUEST_TRIAL };
  }
  // Now it is important to write the result to storage ASAP
  // because performing this request with the same email will from now
  // on result in `granted: false`.
  return {
    type: PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED,
    // When `trialGrantedVal === false` it must mean that
    // the trial has already been activated on a
    // previous / different extension installation / instance.
    // we have no way to check how many times they used it in a previous
    // installation. Perhaps they're trying to trick us
    // by simply reinstalling the extension.
    usesLeft: trialGrantedVal ? initialTrialUsageLimit : 0,
  }
}

export type GetUserEmailFromPageResult =
  { type: 'failed' }
  | { type: 'notFound' }
  | { type: 'found', email: string };

/**
 * @param requestPort The port that the page created as a result of `connect(`
 */
async function getUserEmailFromPage(
  requestPort: browser.Runtime.Port
): Promise<GetUserEmailFromPageResult> {
  return new Promise(async _r => {
    log(TAG, 'Requesting email from content script')

    // Idk when this can happen, and if it really can.
    // But let's just make sure that this promise doesn't hang forever.
    const timeoutId = setTimeout(() => {
      r({ type: 'failed' });
      log(TAG, 'Timeout waiting for content script to respond to email request')
    }, 60 * 1000);

    const r = (...args: Parameters<typeof _r>) => {
      _r(...args)
      log(TAG, `getUserEmailFromPage result:${JSON.stringify(args)}`)
      clearTimeout(timeoutId)
    }

    if (requestPort.sender?.tab?.id == undefined) {
      // This shouldn't happen
      r({ type: 'failed' })
      return
    }

    const resP = browser.tabs.sendMessage(
      requestPort.sender.tab.id,
      { type: 'getUserEmailFromPage' },
      // Meh, there's no need in this
      // { frameId: requestPort.sender.frameId }
    );

    let res;
    try {
      res = await resP
    } catch(e) {
      r({ type: 'failed' })
      return
    }
    if (!res) {
      r({ type: 'failed' })
      return
    }
    r(res)
    log(TAG, `Content script responded to email request: ${JSON.stringify(res)}`)
  })
}

/**
 * When called, adds a listener that waits for a message
 * from our extensionpay.com content script asking for
 * the email address of the user.
 * After responding to one such message, or after a timeout, stops listening
 * for messages.
 */
async function prepareToRespondToEmailRequestFromExtensionpay(
  userEmailP: Promise<GetUserEmailFromPageResult>
) {
  const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0]
    = (msg, sender, sendResponse: (email: string | null) => void) =>
  {
    if (!sender.url) {
      log(TAG, 'Received message, but sender.url is not set')
      return
    }
    if (
      // https://github.com/Glench/ExtPay/blob/8ab80aa38e13fb9012e6e89f657f692375e0a799/dist/ExtPay.common.js#L22-L23
      !sender.url.startsWith(
        `https://extensionpay.com/extension/${EXTPAY_EXTENSION_ID}`
      )
    ) {
      log(TAG, 'Received message, but sender is not extensionpay.com')
      return
    }
    if (msg.type !== MessageType.EMAIL_REQUEST) {
      log(TAG, 'Warn: received a message from extensionpay.com content script, but message type is unrecognized')
      return
    }

    log(TAG, 'Received email request from extensionpay.com content script')
    userEmailP
      .then(result => {
        if (result.type !== 'found') {
          // To be handled in `catch` below
          throw new Error()
        }
        sendResponse(result.email);
        log(TAG, 'Replied to email request from extensionpay.com content script: success')
      })
      .catch(() => {
        log(TAG, 'Replied to email request from extensionpay.com content script: failed')
        sendResponse(null)
      })
      .finally(() => {
        removeListener()
      })
    return true
  }

  // TODO fix: we're not attaching the listener on the top level, so
  // the background scipt could get suspended before the message is received.
  // Very unlikely though as it makes the request almost instantly
  // after the page is loaded.
  browser.runtime.onMessage.addListener(onMessage)
  const removeListener = () => {
    browser.runtime.onMessage.removeListener(onMessage)
    clearTimeout(timeoutId)
  }

  const timeoutId = setTimeout(() => {
    removeListener()
    log(TAG, 'Timeout waiting for extensionpay.com content script to request email')
  }, 3 * 60 * 1000)
}
