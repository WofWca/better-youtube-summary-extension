import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'

import Panel from './panel'

import { parseVid } from './api'
import { PageChapter, PageChapters } from './data'
import log from './log'

const TAG = 'contentScript'

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

  const [panelsObserver, setPanelsObserver] = useState<MutationObserver>()
  const [playerHeight, setPlayerHeight] = useState(560) // px.
  const [blockNode, setBlockNode] = useState<HTMLDivElement>()

  useEffect(() => {
    // Player not inited yet in some page urls,
    // e.g. https://www.youtube.com/@lexfridman
    let player = document.querySelector('video')
    const playerObserver = new ResizeObserver(() => {
      if (player) setPlayerHeight(player.offsetHeight)
    })

    const pageObserver = new MutationObserver(mutationList => {
      setPageUrl(location.href)

      for (const mutation of mutationList) {
        if (!player) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLVideoElement) {
              log(TAG, 'found player with observer')
              player = node
              playerObserver.observe(node)
              break
            }
          }
        }

        let foundChapters = false
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLDivElement) {
            if (node.className.includes('ytp-chapter-hover-container')) {
              setPageChapters({
                pageUrl: location.href,
                chapters: parseChapters(),
              })

              foundChapters = true
              break
            }
          }
        }

        if (foundChapters) break
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
    panelsObserver?.disconnect()
    if (blockNode || !parseVid(pageUrl)) return

    const insertBlock = (parent: Node | null) => {
      if (!parent) return

      const block = document.createElement('div')
      block.id = 'better-youtube-summary-block'
      block.className = 'style-scope ytd-watch-flexy'
      block.style.display = 'block'
      block.style.overflow = 'hidden'
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
          <Panel
            pageUrl={pageUrl}
            pageChapters={pageChapters}
            maxHeight={playerHeight}
          />,
          blockNode,
        )
      }
    </div>
  )
}

const link = document.createElement('link')
link.rel = 'stylesheet'
link.type = 'text/css'
link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@48,200,0,0'
document.head.appendChild(link)

const root = document.createElement('div')
root.id = 'better-youtube-summary-root'
document.body.appendChild(root)
createRoot(root).render(<App />)
