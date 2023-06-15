import UrlMatch from '@fczbkk/url-match'
import useSWR from 'swr'

import log from './log'
import { PageChapter, PageChapters } from './data'

const TAG = 'api'
const BASE_URL = 'https://bys.mthli.com'

export const parseVid = (pageUrl: string): string => {
  // log(TAG, `parseVid, pageUrl=${pageUrl}`)

  // https://github.com/fczbkk/UrlMatch
  const pageUrlMatch = new UrlMatch([
    'https://*.youtube.com/watch*?v=*',
  ])

  const match = pageUrlMatch.test(pageUrl)
  if (!match) return ''

  const url = new URL(pageUrl)
  const params = new URLSearchParams(url.search)
  const vid = params.get('v') ?? ''
  if (!vid) return ''

  return vid
}

export const useSummarize = (
  toggled: boolean,
  pageUrl: string,
  pageChapters?: PageChapters,
  noTranscript?: boolean,
  onEnd?: (success: boolean) => void,
) => {
  const vid = parseVid(pageUrl)
  const chapters = pageUrl === pageChapters?.pageUrl ? pageChapters.chapters : []
  return useSWR(toggled ? [vid, chapters, noTranscript] : null,
    ([vid, chapters, noTranscript]) => summarize(vid, chapters, noTranscript),
    {
      loadingTimeout: 10000, // ms.
      errorRetryCount: 2,
      onSuccess: () => onEnd?.(true),
      onError: (err, key) => {
        log(TAG, `onError, key=${key}, err=${err}`)
        onEnd?.(false)
      },
      onDiscarded: key => {
        log(TAG, `onDiscarded, key=${key}`)
        onEnd?.(false)
      },
    },
  )
}

const summarize = async (
  vid: string,
  chapters?: PageChapter[],
  noTranscript?: boolean,
): Promise<Response> => {
  // log(TAG, `summarize, vid=${vid}, chapters=${JSON.stringify(chapters)}`)

  const res = await fetch(`${BASE_URL}/api/summarize/${vid}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      'chapters': chapters ?? [],
      'no_transcript': Boolean(noTranscript),
    }),
  })

  if (!res.ok) {
    const msg = await res.json()
    throw new Error(msg)
  }

  return res
}
