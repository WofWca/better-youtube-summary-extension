import useSWR, { MutatorCallback } from 'swr'
import useSWRSubscription from 'swr/subscription'

import {
  Chapter,
  Message,
  MessageType,
  PageChapter,
  PaymentStatus,
  PaymentStatusType,
  Settings,
  State,
  Summary,
  Translation,
} from './data'

import browser from 'webextension-polyfill'
import log from './log'
import { parseVid } from './utils'

const TAG = 'api'

// export const BASE_URL = 'https://bys.mthli.com'
export const BASE_URL = 'https://youtube.magicboxpremium.com'
// export const BASE_URL = 'http://localhost:8000'
export const APPLICATION_JSON = 'application/json'

export const feedback = (pageUrl: string, good: boolean) => {
  const vid = parseVid(pageUrl)
  if (!vid) return

  browser.runtime.sendMessage({
    type: MessageType.REQUEST,
    requestUrl: `${BASE_URL}/api/feedback/${vid}`,
    requestInit: {
      method: 'POST',
      headers: {
        'Content-Type': APPLICATION_JSON,
      },
      body: JSON.stringify({
        good: Boolean(good),
        bad: !Boolean(good),
      }),
    },
  })
}

export const useSummarize = (
  toggled: number,
  pageUrl: string,
  pageChapters?: PageChapter[],
  noTranscript?: boolean,
) => {
  const vid = parseVid(pageUrl)
  const chapters = pageChapters ?? []
  log(TAG, `useSummarize, vid=${vid}, toggled=${toggled}, chapters.length=${chapters.length}, last_chapter="${chapters[chapters.length - 1]?.title}"`)

  // Allow resummarize when `toggled` changed.
  return useSWRSubscription(
    toggled ? ['summarize', toggled, vid, chapters, noTranscript] : null,
    ([_tag, _toggled, vid, chapters, noTranscript], { next }) => {
      const port = summarize(vid, chapters, noTranscript, next)
      return () => {
        log(TAG, `useSummarize, disposed, vid=${vid}`)
        port?.disconnect()
      }
    },
    {
      loadingTimeout: 5 * 60 * 1000, // 5 mins.
      errorRetryCount: 2,
      onError: err => log(TAG, `useSummarize, onError, vid=${vid}, err=${err}`),
    },
  )
}

const summarize = (
  vid: string,
  chapters?: PageChapter[],
  noTranscript?: boolean,
  next?: (error?: Error | null, data?: Summary | MutatorCallback<Summary>) => void,
): browser.Runtime.Port | null => {
  log(TAG, `summarize, vid=${vid}`)

  // Let swr into loading state as soon as possible.
  next?.(null, { state: State.DOING })

  const request: Message = {
    type: MessageType.REQUEST,
    requestUrl: `${BASE_URL}/api/summarize/${vid}`,
    requestInit: {
      method: 'POST',
      headers: {
        'Content-Type': APPLICATION_JSON,
      },
      body: JSON.stringify({
        'chapters': chapters ?? [],
        'no_transcript': Boolean(noTranscript),
      }),
    },
  }

  // https://stackoverflow.com/q/53939205
  let port: browser.Runtime.Port | null = null
  try {
    port = browser.runtime.connect({ name: `summarize-${vid}` })
  } catch (e) {
    next?.(e as Error)
    return null
  }

  port.onMessage.addListener(msg => onMessage('summarize', msg, next))
  port.postMessage(request)
  return port
}

const onMessage = (
  tag: string,
  message: Message,
  next?: (error?: Error | null, data?: Summary | MutatorCallback<Summary>) => void,
) => {
  log(TAG, `${tag}, onMessage, message=${JSON.stringify(message)}`)

  const {
    type,
    responseOk,
    responseJson,
    // sseEvent,
    sseData,
    error,
  } = message || {}

  switch (type) {
    case MessageType.RESPONSE:
      if (responseOk) {
        next?.(null, responseJson)

        // Currently this code is only executed when the video has already been
        // summarized before by the server.
        // On the contrary, the code below (`sseEvent === SseEvent.CLOSE`)
        // is only executed when the video has _not_ been summarized before
        // and therefore the result is not cached in the server database.
        // Retrieving a cached result doesn't really cost us much,
        // so let's not decrease the limit here.
        // Use case: the user refreshes the page and clicks "summarize" again.
        // updateDailyUsageLimit()
        // updateTrialUsesLeftCountIfApplicable()
        //
        // TODO But shouldn't either piece of code be executed in both cases
        // (cached and uncached)?
        // Maybe just rewrite all this in a more network-agnostic way, e.g. by
        // watching all chapters and detecting when they're all completed.
      } else {
        next?.(new Error(JSON.stringify(responseJson)))
      }
      break
    case MessageType.SSE:
      const sseData_: Summary = sseData;
      // Don't need to check sseEvent here.
      next?.(null, prev => upsert(sseData_, prev))

      if (sseData_.state === State.DONE) {
        // TODO fix: can't `SseEvent.CLOSE` be emitid in cases other than
        // successful cmpletion? Currently no I think, but you never know.
        updateTrialUsesLeftCountIfApplicable()
        // updateDailyUsageLimit()
      }

      break
    case MessageType.ERROR:
      next?.(error as Error)
      break
    default:
      next?.(new Error(JSON.stringify(message)))
      break
  }
}

async function updateTrialUsesLeftCountIfApplicable() {
  const {
    [Settings.PAYMENT_STATUS]: paymentStatusFromStorage,
  }: {
    [Settings.PAYMENT_STATUS]?: PaymentStatus
  } = await browser.storage.sync
    .get([
      Settings.PAYMENT_STATUS,
    ])

  if (paymentStatusFromStorage == undefined) {
    log(TAG, 'Warn: Used summarization when paymentStatus is not set in storage');
    return
  }

  if (
    paymentStatusFromStorage.type !==
    PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED
  ) {
    log(TAG, `Not updating \`usesLeft\` coutner because paymentStatus.type=${paymentStatusFromStorage.type}`);
    return;
  }

  const usesLeftOld: number = paymentStatusFromStorage.usesLeft;
  let usesLeftNew = usesLeftOld - 1;
  if (usesLeftNew <= 0) {
    // TODO fix: this can happen e.g. when the user has multiple tabs open.
    // They can start summarization on all of the tabs within a couple of
    // seconds, but this code only gets executed when a summarization
    // finishes.
    log(TAG, 'Used summarization when limit is exhausted');
    usesLeftNew = 0;
  }

  const newPaymentStatus: PaymentStatus = {
    ...paymentStatusFromStorage,
    usesLeft: usesLeftNew,
  }
  browser.storage.sync.set({
    [Settings.PAYMENT_STATUS]: newPaymentStatus,
  });
}

const upsert = (curr: Summary, prev?: Summary): Summary => {
  if (!prev) return curr

  const { chapters: prevChapters = [] } = prev
  const { chapters: currChapters = [], state } = curr

  const chapterMap = new Map<string, Chapter>()
  prevChapters.forEach(c => chapterMap.set(c.cid, c))
  currChapters.forEach(c => chapterMap.set(c.cid, c))

  const chapters = Array.from(chapterMap.values())
  chapters.sort((a, b) => a.start - b.start)

  return {
    state,
    chapters,
    // TODO is this ok? I'm not sure what this function (upsert) is doing.
    video_summary: curr.video_summary,
  }
}

export const useTranslate = (toggled: boolean, vid: string, cid: string, lang: string) => {
  log(TAG, `useTranslate, vid=${vid}, cid=${cid}, lang=${lang}, toggled=${toggled}`)

  return useSWR(
    toggled ? ['translate', vid, cid, lang] : null,
    ([_tag, vid, cid, lang]) => {
      const request: Message = {
        type: MessageType.REQUEST,
        requestUrl: `${BASE_URL}/api/translate/${vid}`,
        requestInit: {
          method: 'POST',
          headers: {
            'Content-Type': APPLICATION_JSON,
          },
          body: JSON.stringify({ cid, lang }),
        },
      }

      return browser.runtime
        .sendMessage(request)
        .then<Translation>((message: Message) => {
          const { type, responseOk, responseJson, error } = message
          switch (type) {
            case MessageType.RESPONSE:
              if (responseOk) {
                return Promise.resolve(responseJson)
              } else {
                return Promise.reject(new Error(JSON.stringify(responseJson)))
              }
            case MessageType.ERROR:
              return Promise.reject(error)
            default:
              return Promise.reject(new Error(JSON.stringify(message)))
          }
        })
    },
    {
      loadingTimeout: 90 * 1000, // 90s.
      errorRetryCount: 2,
      onError: err => log(TAG, `useTranslate, onError, vid=${vid}, cid=${cid}, lang=${lang}, err=${err}`),
    },
  )
}
