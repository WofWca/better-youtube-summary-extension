import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import ButtonGroup from '@mui/material/ButtonGroup'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import { ThemeProvider } from '@mui/material/styles'

import ChapterItem from './chapterItem'
import { GooSpinner } from 'react-spinners-kit'

import { useSummarize } from './api'
import { PageChapters, Summary, SummaryState } from './data'
import { Map as ImmutableMap } from 'immutable'

import log from './log'
import theme from './theme'
import './i18n'

const TAG = 'panel'

const checkNoTranscript = (): boolean => {
  const subtitles = document.querySelector('svg.ytp-subtitles-button-icon')
  const opacity = subtitles?.attributes?.getNamedItem('fill-opacity')?.value ?? '1.0'
  return parseFloat(opacity) < 1.0
}

const Panel = ({
  pageUrl,
  pageChapters,
  maxHeight = 560, // px.
}: {
  pageUrl: string,
  pageChapters?: PageChapters,
  maxHeight?: number, // px.
}) => {
  const itemRefs = useRef(new Map<string, Element | null>())

  const [toggled, setToggled] = useState(0)
  const [selected, setSelected] = useState<string>('') // cid.
  const [expands, setExpands] = useState<ImmutableMap<string, boolean>>(ImmutableMap())

  const { t } = useTranslation()
  const { data, error } = useSummarize(toggled, pageUrl, pageChapters, checkNoTranscript())

  // TODO
  const { state = SummaryState.NOTHING, chapters = [] } = (data || {}) as Summary
  const isDoing = state === SummaryState.DOING

  const list = chapters.map((c, i) => (
    <ChapterItem
      {...c}
      key={c.cid}
      ref={el => itemRefs.current.set(c.cid, el)}
      isLastItem={i === chapters.length - 1}
      selected={c.cid === selected}
      expanded={expands.get(c.cid, false)}
      onExpand={expand => setExpands(expands.set(c.cid, expand))}
      onSeekTo={seconds => {
        log(TAG, `onSeekTo, seconds=${seconds}`)
        const player = document.querySelector('video')
        if (player) player.currentTime = seconds
      }}
    />
  ))

  // https://developer.mozilla.org/zh-CN/docs/Web/API/Element/scrollIntoView
  const scrollIntoView = (cid: string) => {
    log(TAG, `scrollIntoView, cid=${cid}`)

    itemRefs.current.get(cid)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })

    setSelected(cid)
  }

  const syncToVideoTime = () => {
    const player = document.querySelector('video')
    if ((!player) || (chapters.length <= 0)) return

    const currentTime = player.currentTime // in seconds.
    log(TAG, `syncToViewTime, currentTime=${currentTime}`)

    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].seconds >= currentTime) {
        const { cid } = i > 0 ? chapters[i - 1] : chapters[0]
        scrollIntoView(cid)
        return
      }
    }

    // If not seleted in for loop, then must be the last item.
    scrollIntoView(chapters[chapters.length - 1].cid)
  }

  useEffect(() => {
    log(TAG, `useEffect, pageUrl=${pageUrl}`)
    setToggled(0) // cancel all requests before.
  }, [pageUrl])

  useEffect(() => {
    log(TAG, `useEffect, selected=${selected}`)
    if (selected) setTimeout(() => setSelected(''), 2000) // ms.
  }, [selected])

  return (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          display: 'flex',
          overflow: 'hidden',
          flexDirection: 'column',
          maxHeight: `${maxHeight}px`,
          bgcolor: 'background.default',
        }}
      >
        <AppBar position='static' color='transparent' elevation={0}>
          <Toolbar
            variant='dense'
            style={{ /* instead of sx */
              justifyContent: 'space-between',
              paddingLeft: '20px',
              paddingRight: '20px',
            }}
          >
            <ButtonGroup disableElevation>
              <Tooltip title={t('summarize').toString()}>
                {
                  /*
                   * Tooltip will always show if its children changed accidentally,
                   * so use a Box as wrapper to let Tooltip can always foucs.
                   */
                }
                <Box>
                  <IconButton
                    aria-label={t('summarize').toString()}
                    color='inherit'
                    edge='start'
                    disabled={isDoing}
                    onClick={() => setToggled(toggled + 1)}
                  >
                    {
                      !isDoing &&
                      <span className='material-symbols-outlined'>summarize</span>
                    }
                    {
                      isDoing &&
                      <GooSpinner
                        size={24}
                        color={theme.palette.text.primary}
                        loading
                      />
                    }
                  </IconButton>
                </Box>
              </Tooltip>
              {
                list.length > 0 &&
                <Tooltip title={t('sync_to_video_time').toString()}>
                  <IconButton
                    aria-label={t('sync_to_video_time').toString()}
                    color='inherit'
                    sx={{ ml: '8px' }}
                    onClick={syncToVideoTime}
                  >
                    <span className="material-symbols-outlined">schedule</span>
                  </IconButton>
                </Tooltip>
              }
              {
                list.length > 0 &&
                <Tooltip title={t('unfold_less').toString()}>
                  <IconButton
                    aria-label={t('unfold_less').toString()}
                    color='inherit'
                    sx={{ ml: '8px' }}
                    onClick={() => setExpands(expands.clear())}
                  >
                    <span className="material-symbols-outlined">unfold_less</span>
                  </IconButton>
                </Tooltip>
              }
            </ButtonGroup>
            <Tooltip title={t('settings').toString()}>
              <IconButton
                aria-label={t('settings').toString()}
                color='inherit'
                edge='end'
                onClick={() => {
                  // TODO
                }}
              >
                <span className="material-symbols-outlined">settings</span>
              </IconButton>
            </Tooltip>
          </Toolbar>
          {list.length > 0 && <Divider light />}
        </AppBar>
        <Box
          sx={{
            display: 'block',
            overflow: 'hidden scroll',
          }}
        >
          {
            list.length > 0 &&
            <List subheader={<li />}>
              {list}
            </List>
          }
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default Panel
