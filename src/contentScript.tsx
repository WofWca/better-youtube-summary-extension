import browser from 'webextension-polyfill'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'

import Panel from './panel'

import log from './log'
import { parseVid } from './utils'

import type { GetUserEmailFromPageResult } from './background'

// Insert as soon as possible.
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@48,200,0,0'
document.head.appendChild(link)

const TAG = 'contentScript'

const App = () => {
  const [pageUrl, setPageUrl] = useState(location.href)
  const [panelsObserver, setPanelsObserver] = useState<MutationObserver>()
  const [blockNode, setBlockNode] = useState<HTMLDivElement>()

  useEffect(() => {
    const observer = new MutationObserver(() => setPageUrl(location.href))
    observer.observe(document, { subtree: true, childList: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    panelsObserver?.disconnect()
    if (blockNode || !parseVid(pageUrl)) return

    const insertBlock = (parent: Node | null) => {
      if (!parent) return

      const block = document.createElement('div')
      block.id = 'better-youtube-summary-block'
      block.className = 'style-scope ytd-watch-flexy'
      block.style.display = 'block'
      block.style.overflow = 'hidden'
      block.style.minHeight = '48px'
      block.style.marginBottom = '8px'
      block.style.border = '1px solid var(--yt-spec-10-percent-layer)'
      block.style.borderRadius = '12px'

      const ref = parent.childNodes.length > 0 ? parent.childNodes[0] : null
      parent.insertBefore(block, ref)
      setBlockNode(block)
    }

    const panels = document.querySelector('#secondary-inner')
    if (panels) {
      log(TAG, 'insert block with selector')
      insertBlock(panels)
      return
    }

    const observer = new MutationObserver(mutationList => {
      for (const mutation of mutationList) {
        let found = false

        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLDivElement) {
            if (node.id === 'panels') {
              log(TAG, 'insert block with observer')
              insertBlock(node.parentNode)
              found = true
              break
            }
          }
        }

        if (found) {
          observer.disconnect()
          break
        }
      }
    })

    setPanelsObserver(observer)
    observer.observe(document, { subtree: true, childList: true })
  }, [pageUrl])

  return (
    <div>
      {
        blockNode &&
        createPortal(
          <Panel pageUrl={pageUrl} />,
          blockNode,
        )
      }
    </div>
  )
}

const root = document.createElement('div')
root.id = 'better-youtube-summary-root'
document.body.appendChild(root)
createRoot(root).render(<App />)

// Email stuff:
browser.runtime.onMessage.addListener(
  (
    message,
    _sender,
    sendResponse: (response: GetUserEmailFromPageResult) => void
  ) => {
    if (message.type !== 'getUserEmailFromPage') {
      log(TAG, 'Received message, but type is not getUserEmailFromPage. Ignoring')
      return
    }
    log(TAG, 'getUserEmailFromPage request received')

    getUserEmailFromPage()
      .then(email => {
        if (!email) {
          sendResponse({ type: 'notFound' })
        } else {
          sendResponse({ type: 'found', email })
        }
      })
      .catch(() => {
        // This shouldn't happen, but let's ensure to execute the callback.
        log(TAG, 'Warn: getUserEmailFromPage, failed')
        sendResponse({ type: 'failed' })
      })

    return true;
  }
)
// TODO perf: import this function dynamically.
async function getUserEmailFromPage(): Promise<string | null> {
  if (
    location.host !== 'www.youtube.com'
    && location.host !== 'youtube.com'
  ) {
    log(TAG, 'Warn: getUserEmailFromPage, but we\'re not on YouTube?')
    return null;
  }

  let body: string;
  try {
    // This the URL that YouTube fetches when you click "Switch account".
    // When you click that, the menu shows your email address
    // and accounts that you can switch to.
    // Apparently the menu is build based on this data,
    // which contains the email.
    body = await (await fetch('/getAccountSwitcherEndpoint')).text()
  } catch (e) {
    log(TAG, 'Failed to fetch user email from YouTube. Either the user is not logged in, or we messed up.')
    return null
  }

  return findGmailAddr(body)
}

// Of course I'm not gonna pretend that his is the most correct
// and reliable email searcher in the world, but it's good enough for now.
// See https://stackoverflow.com/questions/201323/how-can-i-validate-an-email-address-using-a-regular-expression
/**
 * @example
 * findGmailAddr('something"abc@gmail.com"def') === 'abc@gmail.com'
 * findGmailAddr('something"a@bcd.com"def') === null
 */
function findGmailAddr(str: string): string | null {
  const atPart = '@gmail.com'
  const atPartInd = str.indexOf(atPart + '"')
  if (atPartInd < 0) {
    return null
  }

  if (str.indexOf(atPart + 1, atPartInd) >= 0) {
    log(TAG, 'Warn: found 2 or more emails. Returning just the 1st one')
  }

  // The email address is quoted
  const startingQuoteInd = str.lastIndexOf('"', atPartInd)
  if (startingQuoteInd < 0) {
    log(TAG, 'Warn: @gmail.com found, but still failed to parse email')
    return null
  }

  return str.slice(startingQuoteInd + 1, atPartInd) + atPart
}
