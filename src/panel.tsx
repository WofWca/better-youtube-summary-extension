import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from 'usehooks-ts'

import Alert, { AlertColor } from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import ButtonGroup from '@mui/material/ButtonGroup'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import List from '@mui/material/List'
import ListItemIcon from '@mui/material/ListItemIcon'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { ThemeProvider } from '@mui/material/styles'
import { lightTheme, darkTheme } from './theme'

import ChapterItem from './chapterItem'
import { GooSpinner } from 'react-spinners-kit'

import {
  Message,
  MessageType,
  PageChapter,
  PaymentStatus,
  PaymentStatusType,
  Settings,
  State,
  Summary,
  TargetLang,
  initialTrialUsageLimit,
  mustActivateTrialOrPayErrorMessage,
  mustPayErrorMessage,
} from './data'
import { copyChapters, isFirefox, parseVid } from './utils'
import { useSummarize, feedback, useTranslate } from './api'
import { Map as ImmutableMap } from 'immutable'

import browser from 'webextension-polyfill'
import log from './log'
import './panel.css'
import './i18n'
import ReactMarkdown from 'react-markdown'

const TAG = 'panel'

// TODO move these into "options" or build variables idk
const SHOW_SYNC_TO_VIDEO_TIME = false;
const SHOW_UNFOLD_LESS = false;

const checkIsDarkMode = (prefersDarkMode: boolean): boolean => {
  // Follow the System Preferences.
  if (prefersDarkMode) return true

  const flexy = document.querySelector('ytd-watch-flexy')
  if (!flexy) return prefersDarkMode

  // Check if YouTube Settings.
  const check = flexy.attributes.getNamedItem('is-dark-theme')
  return Boolean(check) || prefersDarkMode
}

const checkNoTranscript = (): boolean => {
  const subtitles = document.querySelector('svg.ytp-subtitles-button-icon')
  const opacity = subtitles?.attributes?.getNamedItem('fill-opacity')?.value ?? '1.0'
  return parseFloat(opacity) < 1.0
}

const initTargetLang = (): string => {
  const keys = Object.keys(TargetLang)
  const lang = document
    .documentElement
    .attributes
    .getNamedItem('lang')
    ?.textContent
    ?.trim() ?? ''

  for (const key of keys) {
    if (lang.startsWith(key)) return key
  }

  return keys[0] // default.
}

// https://stackoverflow.com/a/62461987
const openTab = (url: string) => {
  browser.runtime.sendMessage({
    type: MessageType.OPEN_TAB,
    requestUrl: url,
  } as Message)
}
const openOptionsPage = () => openTab(browser.runtime.getURL('options.html'))

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

const Panel = ({ pageUrl }: { pageUrl: string }) => {
  const [prevPageUrl, setPrevPageUrl] = useState(pageUrl)
  const [chaptersReadyAt, setChaptersReadyAt] = useState(Date.now())
  const [chaptersReady, setChaptersReady] = useState(true)

  const itemRefs = useRef(new Map<string, Element | null>())
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')
  const currentTheme = checkIsDarkMode(prefersDarkMode) ? darkTheme : lightTheme
  const iconColorActive = currentTheme.palette.action.active
  const iconColorDisabled = currentTheme.palette.action.disabled
  const iconColorHighlight = currentTheme.palette.primary.main
  const targetLangkeys = Object.keys(TargetLang)

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | undefined>();

  const [summarizing, setSummarizing] = useState(0)
  const [translatable, setTranslatable] = useState(false)
  const [targetLang, setTargetLang] = useState(initTargetLang())
  const [copyWithTimestamps, setCopyWithTimestamps] = useState(false)

  const [selected, setSelected] = useState<string>('') // cid.
  const [expands, setExpands] = useState<ImmutableMap<string, boolean>>(ImmutableMap())

  const [anchorEl, _setAnchorEl] = useState<HTMLElement | null>(null)
  const closeMenu = () => _setAnchorEl(null)
  const openMenu = (anchor: HTMLElement) => _setAnchorEl(anchor)
  const [playerHeight, setPlayerHeight] = useState(560) // px.

  if (pageUrl !== prevPageUrl) {
    log(TAG, `new pageUrl new=${pageUrl}, old=${prevPageUrl}`);
    setPrevPageUrl(pageUrl);

    // This is important to do in order to not start another
    // `useSummarize` request immediately after the URL change.
    // It's not only for performance reasons but also because
    // right after the URL change `parseChapters()` might return the
    // chapters from the previous video
    // (because the new page hasn't fully loaded yet),
    // and the backend would save it to the database, but it will associate it
    // with the new video URL.
    // TODO refactor: perhaps there is a less fragile way to do this?
    setSummarizing(0) // cancel all requests before.
    setTranslatable(false) // cancel all requests before.

    // But the user might still start summarization manually.
    // Let's stop that with this one stupid timeout.
    setChaptersReady(false)
    // TODO fix: actually detect whether the new chapters have loaded.
    setChaptersReadyAt(Date.now() + 3 * 1000)
  }
  useEffect(() => {
    if (chaptersReady) {
      return;
    }
    const untilChaptersReady = chaptersReadyAt - Date.now();
    const timeoutId = setTimeout(() => {
      log(TAG, `assuming that chapters have loaded`);
      setChaptersReady(true);
    }, untilChaptersReady);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [chaptersReady, chaptersReadyAt])

  const { t } = useTranslation()
  const { data, error } = useSummarize(
    summarizing,
    pageUrl,
    parseChapters(),
    checkNoTranscript(),
  )

  const {
    state,
    chapters = [],
    video_summary: videoSummaryUntranslated,
  } = (data || {}) as Summary;
  const doing = (state === State.DOING) && !error
  const done = (state === State.DONE) && !error

  const { data: videoSummaryTranslateData, /* error, isLoading */ } = useTranslate(
    // TODO what is `translatable` idk?
    translatable,
    parseVid(pageUrl),
    'video_summary', // Special value instead of UUID cid.
    targetLang
  )
  const { summary: videoSummaryTranslated } = videoSummaryTranslateData || {}

  const videoSummary = videoSummaryTranslated || videoSummaryUntranslated;

  const summarizeDisabled = doing || !chaptersReady

  const transDisabled = !done
  let transIconColor = iconColorActive
  if (transDisabled) {
    transIconColor = iconColorDisabled
  } else if (translatable) {
    transIconColor = iconColorHighlight
  }

  let showAlert = false
  let alertSeverity: AlertColor = 'info'
  let alertTitle = ''
  let alertMsg = ''
  if (error) {
    const { name, message } = error as Error
    // Otherwise there is no real need to show the error, because
    // currently we're opening a popup page, which makes the issue obvious.
    if (
      !([
        mustPayErrorMessage,
        mustActivateTrialOrPayErrorMessage
      ].includes(message))
    ) {
      showAlert = true
      alertSeverity = 'error'
      alertTitle = name
      alertMsg = message
    }
  } else if (state === State.NOTHING) {
    showAlert = true
    alertSeverity = 'warning'
    alertTitle = t('no_transcript').toString()
    alertMsg = t('no_transcript_desc').toString()
  }

  const list = chapters.map((c, i) => (
    <ChapterItem
      {...c}
      key={c.cid}
      ref={el => itemRefs.current.set(c.cid, el)}
      theme={currentTheme}
      targetLang={targetLang}
      translatable={translatable}
      isLastItem={i === chapters.length - 1}
      selected={c.cid === selected}
      expanded={expands.get(c.cid, false)}
      onExpand={expand => setExpands(expands.set(c.cid, expand))}
      onSeekTo={start => {
        log(TAG, `onSeekTo, start=${start}`)
        const player = document.querySelector('video')
        if (player) player.currentTime = start
      }}
    />
  ))

  const onClose = () => {
    setSelected('') // clear.
    setExpands(expands.clear())
    setSummarizing(0) // reset.
    setTranslatable(false) // reset.
  }

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
      if (chapters[i].start >= currentTime) {
        const { cid } = i > 0 ? chapters[i - 1] : chapters[0]
        scrollIntoView(cid)
        return
      }
    }

    // If not seleted in for loop, then must be the last item.
    scrollIntoView(chapters[chapters.length - 1].cid)
  }

  useEffect(() => {
    browser.storage.sync
      .get([
        Settings.TRANSLATION_TARGET_LANG,
        Settings.COPY_WITH_TIMESTAMPS,
        Settings.PAYMENT_STATUS,
      ])
      .then(({
        [Settings.TRANSLATION_TARGET_LANG]: lang,
        [Settings.COPY_WITH_TIMESTAMPS]: copy,
        [Settings.PAYMENT_STATUS]: paymentStatus,
      }: {
        [Settings.TRANSLATION_TARGET_LANG]?: string,
        [Settings.COPY_WITH_TIMESTAMPS]?: boolean,
        [Settings.PAYMENT_STATUS]?: PaymentStatus,
      }) => {
        // We only update the usage limit in api.ts and not simply
        // `onClick` of the "summary" button because
        // we don't want to spend the limit if the request fails for
        // whatever reason.
        setPaymentStatus(paymentStatus)

        setCopyWithTimestamps(Boolean(copy))

        if (targetLangkeys.includes(lang as any)) {
          setTargetLang(lang as any)
          return
        }

        // If no settings yet.
        browser.storage.sync.set({ [Settings.TRANSLATION_TARGET_LANG]: targetLang })
      })

    // @ts-ignore
    const listener = (changes, areaName) => {
      if (areaName !== 'sync') return

      // @ts-ignore
      for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
        log(TAG, `storage.onChanged, key=${key}, oldValue=${oldValue}, newValue=${newValue}`)
        if (key === Settings.TRANSLATION_TARGET_LANG) {
          setTargetLang(newValue)
        } else if (key === Settings.COPY_WITH_TIMESTAMPS) {
          setCopyWithTimestamps(newValue)
        } else if (key === Settings.PAYMENT_STATUS) {
          setPaymentStatus(newValue)
        }
      }
    }

    const player = document.querySelector('video')
    log(TAG, `useEffect, init, player=${player}`)

    const playerObserver = new ResizeObserver(() => {
      if (!player) return
      const height = player.offsetHeight
      log(TAG, `ResizeObserverCallback, height=${height}`)
      setPlayerHeight(height)
    })

    if (player) playerObserver.observe(player)
    browser.storage.onChanged.addListener(listener)

    return () => {
      playerObserver.disconnect()
      browser.storage.onChanged.removeListener(listener)
    }
  }, [])

  useEffect(() => {
    log(TAG, `useEffect, selected=${selected}`)
    if (selected) setTimeout(() => setSelected(''), 2000) // ms.
  }, [selected])

  const menu = (
    <Menu
      anchorReference='anchorPosition'
      anchorPosition={{
        top: (anchorEl?.getBoundingClientRect()?.top ?? 0) - 2,
        left: (anchorEl?.getBoundingClientRect()?.left ?? 0) - 56,
      }}
      open={Boolean(anchorEl)}
      onClose={closeMenu}
    >
      <MenuItem
        key={'good'}
        sx={{ pr: '18px' }}
        disabled={!done}
        onClick={() => {
          closeMenu()
          feedback(pageUrl, true)
          browser.storage.sync.get(Settings.ALREADY_OPENED_REVIEWS_PAGE).then(res => {
            const { [Settings.ALREADY_OPENED_REVIEWS_PAGE]: alreadyOpened }:
              { [Settings.ALREADY_OPENED_REVIEWS_PAGE]?: string } = res
            if (!alreadyOpened) {
              browser.storage.sync.set({
                [Settings.ALREADY_OPENED_REVIEWS_PAGE]: true
              })
              openTab(
                // TODO Microsoft store?
                isFirefox()
                  ? `https://addons.mozilla.org/firefox/addon/${browser.runtime.id}/reviews/`
                  // https://developer.chrome.com/docs/webstore/support-users/#the_rating_tab
                  : `https://chrome.google.com/webstore/detail/${browser.runtime.id}/reviews`
              )
            }
          })
        }}
      >
        <ListItemIcon>
          <span className='material-symbols-outlined'>thumb_up</span>
        </ListItemIcon>
        {t('good').toString()}
      </MenuItem>
      <MenuItem
        key={'bad'}
        sx={{ pr: '18px' }}
        disabled={!done}
        onClick={() => {
          closeMenu()
          feedback(pageUrl, false)
        }}
      >
        <ListItemIcon>
          <span className='material-symbols-outlined'>thumb_down</span>
        </ListItemIcon>
        {t('bad').toString()}
      </MenuItem>
      <MenuItem
        key={'language'}
      >
        <FormControl>
          <InputLabel id="translation-target-lang-label">
            {t('translation').toString()}
          </InputLabel>
          <Select
            labelId='translation-target-lang-label'
            variant='filled'
            value={targetLang}
            onChange={({ target: { value: key } }) => {
              // Don't useEffect for `targetLangKey` here.
              browser.storage.sync.set({ [Settings.TRANSLATION_TARGET_LANG]: key })
              setTargetLang(key)
            }}
          >
            {
              Object.keys(TargetLang).map(key => (
                <MenuItem key={key} value={key}>
                  {/* @ts-ignore */}
                  {TargetLang[key]}
                </MenuItem>
              ))
            }
          </Select>
        </FormControl>
      </MenuItem>
      <MenuItem
        key={'settings'}
        sx={{ pr: '18px' }}
        onClick={() => {
          closeMenu()
          openOptionsPage()
        }}
      >
        <ListItemIcon>
          <span className='material-symbols-outlined'>settings</span>
        </ListItemIcon>
        {t('settings').toString()}
      </MenuItem>
    </Menu>
  )

  return (
    <ThemeProvider theme={currentTheme}>
      <Typography
        variant='h3'
        sx={{
          color: 'text.primary',
          fontWeight: 900,
          fontSize: '2rem',
          mb: '1rem'
        }}
      >
        {t('summary').toString()}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          overflow: 'hidden',
          flexDirection: 'column',
          minHeight: '48px',
          maxHeight: `${playerHeight > 240 ? playerHeight : 240}px`,
          bgcolor: 'background.default',
          border: '1px solid var(--yt-spec-10-percent-layer)',
          borderRadius: '12px',
        }}
      >
        <AppBar position='static' color='transparent' elevation={0}>
          <Toolbar
            variant='dense'
            style={{ /* instead of sx */
              justifyContent: 'space-between',
              paddingLeft: '8px',
              paddingRight: '8px',
            }}
          >
            <ButtonGroup disableElevation>
              <Tooltip title={t('summarize').toString()}>
                {
                  // Tooltip will always show if its children changed accidentally,
                  // so use a Box as wrapper to let Tooltip can always foucs.
                }
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <IconButton
                    aria-label={t('summarize').toString()}
                    disabled={
                      summarizeDisabled
                      // Not disabling if not paid / trial ended because
                      // `onClick` handles that case.
                    }
                    style={{ color: summarizeDisabled ? iconColorDisabled : iconColorActive }} // not `sx` here.
                    onClick={() => setSummarizing(summarizing + 1)}
                  >
                    {
                      !summarizeDisabled &&
                      <span className='material-symbols-outlined'>summarize</span>
                    }
                    {
                      summarizeDisabled &&
                      <GooSpinner
                        size={24}
                        color={currentTheme.palette.text.primary}
                        loading
                      />
                    }
                  </IconButton>
                </Box>
              </Tooltip>
              {
                list.length <= 0 &&
                (paymentStatus?.type
                  === PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED
                ? (
                  paymentStatus.usesLeft > 0 ?
                  <Tooltip title={t('trial_uses_left').toString()}>
                    <Typography
                      variant='body1'
                      sx={{
                        color: 'text.primary',
                        opacity: 0.6,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {
                        `${paymentStatus.usesLeft} / ${initialTrialUsageLimit}`
                      }
                    </Typography>
                  </Tooltip>
                  :
                  <Typography
                    variant='body1'
                    sx={{
                      color: 'text.primary',
                      opacity: 0.6,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {t('pay_call_to_action').toString()}
                  </Typography>
                )
                : (
                  !doing && !done &&
                  <Typography
                    variant='body1'
                    sx={{
                      color: 'text.primary',
                      opacity: 0.6,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {'← ' + t('start_summarizing').toString()}
                  </Typography>
                )
                )
              }
              {
                SHOW_SYNC_TO_VIDEO_TIME && list.length > 0 &&
                <Tooltip title={t('sync_to_video_time').toString()}>
                  <IconButton
                    aria-label={t('sync_to_video_time').toString()}
                    style={{ color: iconColorActive, marginLeft: '8px' }} // not `sx` here.
                    onClick={syncToVideoTime}
                  >
                    <span className='material-symbols-outlined'>schedule</span>
                  </IconButton>
                </Tooltip>
              }
              {
                SHOW_UNFOLD_LESS && list.length > 0 &&
                <Tooltip title={t('unfold_less').toString()}>
                  <IconButton
                    aria-label={t('unfold_less').toString()}
                    style={{ color: iconColorActive, marginLeft: '8px' }} // not `sx` here.
                    onClick={() => setExpands(expands.clear())}
                  >
                    <span className='material-symbols-outlined'>unfold_less</span>
                  </IconButton>
                </Tooltip>
              }
              {
                list.length > 0 &&
                <Tooltip title={t('close').toString()}>
                  <IconButton
                    aria-label={t('close').toString()}
                    style={{ color: iconColorActive, marginLeft: '8px' }} // not `sx` here.
                    onClick={onClose}
                  >
                    <span className='material-symbols-outlined'>close</span>
                  </IconButton>
                </Tooltip>
              }
            </ButtonGroup>
            <ButtonGroup>
              {
                list.length > 0 &&
                <Tooltip title={t('copy').toString()}>
                  <IconButton
                    aria-label={t('copy').toString()}
                    disabled={!done}
                    style={{ // not `sx` here.
                      marginRight: '8px',
                      color: done ? iconColorActive : iconColorDisabled,
                    }}
                    onClick={() => {
                      copyChapters(
                        // TODO fix: copy translated. For `chapters`,
                        // translation is done inside of `ChapterItem`.
                        videoSummaryUntranslated || '',
                        chapters,
                        copyWithTimestamps
                      )
                    }}
                  >
                    <span className='material-symbols-outlined'>content_copy</span>
                  </IconButton>
                </Tooltip>
              }
              {
                list.length > 0 &&
                <Tooltip title={t('translate').toString()}>
                  <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    mr: '8px',
                  }}>
                    <IconButton
                      aria-label={t('translate').toString()}
                      disabled={transDisabled}
                      style={{ color: transIconColor }} // not `sx` here.
                      onClick={() => {
                        const lang = chapters.length > 0 ? chapters[0].lang : targetLangkeys[0]
                        if (lang === targetLang || !targetLang) {
                          // TODO improvement: previously we'd open the
                          // options page that contained the "language" input
                          // but now we moved it here, to the panel.
                          // We need to indicate the issue somehow.
                          // I have tried to utilize the "alert", but currently
                          // its `onClose` resets a lot of state. Not ideal.

                          // openOptionsPage()
                        } else {
                          setTranslatable(!translatable)
                        }
                      }}
                    >
                      {/* SVG copied from YouTube, not perfect but ok. */}
                      <svg
                        viewBox='0 0 24 24'
                        width='22px'
                        height='22px'
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '1px',
                          fill: transIconColor,
                        }}
                      >
                        <path d='M13.33 6c-1 2.42-2.22 4.65-3.57 6.52l2.98 2.94-.7.71-2.88-2.84c-.53.67-1.06 1.28-1.61 1.83l-3.19 3.19-.71-.71 3.19-3.19c.55-.55 1.08-1.16 1.6-1.83l-.16-.15c-1.11-1.09-1.97-2.44-2.49-3.9l.94-.34c.47 1.32 1.25 2.54 2.25 3.53l.05.05c1.2-1.68 2.29-3.66 3.2-5.81H2V5h6V3h1v2h7v1h-2.67zM22 21h-1l-1.49-4h-5.02L13 21h-1l4-11h2l4 11zm-2.86-5-1.86-5h-.56l-1.86 5h4.28z' />
                      </svg>
                    </IconButton>
                  </Box>
                </Tooltip>
              }
              <Tooltip title={t('more').toString()}>
                <IconButton
                  aria-label={t('more').toString()}
                  style={{ color: iconColorActive }} // not `sx` here.
                  onClick={e => openMenu(e.currentTarget)}
                >
                  {/* SVG copied from YouTube, not perfect but ok. */}
                  <svg
                    viewBox='0 0 24 24'
                    width='22px'
                    height='22px'
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '1px',
                      fill: iconColorActive,
                    }}
                  >
                    <path d='M12 16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zM10.5 12c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5zm0-6c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5z' />
                  </svg>
                </IconButton>
              </Tooltip>
              {menu}
            </ButtonGroup>
          </Toolbar>
          {list.length > 0 && <Divider />}
        </AppBar>
        {
          showAlert &&
          <Alert
            severity={alertSeverity}
            sx={{
              display: 'flex',
              alignItems: 'center',
              borderRadius: 0,
              paddingTop: 0,
              paddingBottom: 0,
              fontSize: '1.2rem',
            }}
            icon={false}
            action={
              <Tooltip title={t('close').toString()}>
                <IconButton
                  aria-label={t('close').toString()}
                  style={{ color: iconColorActive, marginTop: '-4px' }} // not `sx` here.
                  onClick={onClose}
                >
                  <span className='material-symbols-outlined'>close</span>
                </IconButton>
              </Tooltip>
            }
          >
            <AlertTitle
              sx={{
                marginTop: 0,
                marginBottom: '4px',
                fontSize: '1.4rem',
              }}
            >
              {alertTitle}
            </AlertTitle>
            {alertMsg}
          </Alert>
        }
        <Box
          sx={{
            display: 'block',
            overflow: 'hidden scroll',
          }}
        >
          {
            videoSummary &&
            <Box>
              <ReactMarkdown className={`markdown-${currentTheme.palette.mode}`}>
                {videoSummary}
              </ReactMarkdown>
            </Box>
          }
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
