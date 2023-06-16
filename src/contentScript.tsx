import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'

import Panel from './panel'

import log from './log'
import { parseVid } from './api'
import { PageChapter, PageChapters } from './data'

const TAG = 'contentScript'
const BLOCK_ID = 'better-youtube-summary-block'
const DEFAULT_PLAYER_HEIGHT = 560 // px.

// https://stackoverflow.com/a/75704708
const parseChapters = (): PageChapter[] => {
  const elements = Array.from(
    document.querySelectorAll(
      '#panels ytd-engagement-panel-section-list-renderer:nth-child(2) #content ytd-macro-markers-list-renderer #contents ytd-macro-markers-list-item-renderer #endpoint #details'
    )
  )

  const chapters = elements.map(node => ({
    title: node.querySelector('.macro-markers')?.textContent,
    timestamp: node.querySelector('#time')?.textContent,
  }))

  const filtered = chapters.filter(c =>
    c.title !== undefined &&
    c.title !== null &&
    c.timestamp !== undefined &&
    c.timestamp !== null
  )

  return [
    ...new Map(filtered.map(c => [c.timestamp, c])).values(),
  ] as PageChapter[]
}

const App = () => {
  const [pageUrl, setPageUrl] = useState(location.href)
  const [pageChapters, setPageChapters] = useState<PageChapters>()
  const [panelObserver, setPanelObserver] = useState<MutationObserver>()
  const [playerHeight, setPlayerHeight] = useState(DEFAULT_PLAYER_HEIGHT)
  const [blockNode, setBlockNode] = useState<HTMLDivElement>()

  useEffect(() => {
    const player = document.querySelector('video')
    const playerObserver = new ResizeObserver(() => {
      if (player) setPlayerHeight(player.offsetHeight)
    })

    const pageObserver = new MutationObserver(mutationList => {
      setPageUrl(location.href)

      for (const mutation of mutationList) {
        let found = false

        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLDivElement) {
            if (node.className.includes('ytp-chapter-hover-container')) {
              setPageChapters({
                pageUrl: location.href,
                chapters: parseChapters(),
              })

              found = true
              break
            }
          }
        }

        if (found) break
      }
    })

    if (player) playerObserver.observe(player)
    pageObserver.observe(document, { subtree: true, childList: true })

    return () => {
      pageObserver.disconnect()
      playerObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const subtitles = document.querySelector('svg.ytp-subtitles-button-icon')
    const opacity = subtitles?.attributes?.getNamedItem('fill-opacity')?.value ?? '1.0'
    const noTranscript = parseFloat(opacity) < 1.0
    log(TAG, `check, noTranscript=${noTranscript}`)

    panelObserver?.disconnect()
    if (!parseVid(pageUrl)) return
    if (document.getElementById(BLOCK_ID)) return

    const insertBlock = (parent: Node | null) => {
      if (!parent) return

      const block = document.createElement('div')
      block.id = BLOCK_ID
      block.className = 'style-scope ytd-watch-flexy'
      block.style.display = 'block'
      block.style.overflow = 'hidden'
      block.style.height = '50px' // minimal.
      block.style.maxHeight = `${playerHeight}px`
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

    setPanelObserver(observer)
    observer.observe(document, { subtree: true, childList: true })
  }, [pageUrl])

  // TODO
  useEffect(() => {
    log(TAG, `useEffect, playerHeight=${playerHeight}`)
    const block = document.getElementById(BLOCK_ID)
    if (!(block instanceof HTMLDivElement)) return
    block.style.maxHeight = `${playerHeight}px`
  }, [playerHeight])

  return (
    <div>
      {blockNode && createPortal(<Panel />, blockNode)}
    </div>
  )
}

const root = document.createElement('div')
root.id = 'better-youtube-summary-root'
document.body.appendChild(root)
createRoot(root).render(<App />)
