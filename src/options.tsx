import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'

import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Container from '@mui/material/Container'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import CssBaseline from '@mui/material/CssBaseline'
import useMediaQuery from '@mui/material/useMediaQuery'
import { ThemeProvider } from '@mui/material/styles'
import { lightTheme, darkTheme } from './theme'

import { Message, MessageType, Settings, TargetLang } from './data'

import browser from 'webextension-polyfill'
import './i18n'

// const TAG = 'options'

const manifest = browser.runtime.getManifest()
const version = `v${manifest.version}`

const App = () => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')
  const currentTheme = prefersDarkMode ? darkTheme : lightTheme

  const targetLangkeys = Object.keys(TargetLang)
  const [targetLang, setTargetLang] = useState(targetLangkeys[0])
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [copyWithTimestamps, setCopyWithTimestamps] = useState(false)

  const { t } = useTranslation()
  const title = t('title').toString()

  useEffect(() => {
    browser.storage.sync
      .get([
        Settings.OPENAI_API_KEY,
        Settings.TRANSLATION_TARGET_LANG,
        Settings.COPY_WITH_TIMESTAMPS,
      ])
      .then(({
        [Settings.OPENAI_API_KEY]: key,
        [Settings.TRANSLATION_TARGET_LANG]: lang,
        [Settings.COPY_WITH_TIMESTAMPS]: copy,
      }) => {
        // A component is changing a controlled input to be uncontrolled.
        // This is likely caused by the value changing from a defined to undefined, which should not happen.
        setOpenAiApiKey(key ?? '')
        setCopyWithTimestamps(Boolean(copy))

        if (targetLangkeys.includes(lang)) {
          setTargetLang(lang)
          return
        }

        // If no settings yet.
        browser.storage.sync.set({ [Settings.TRANSLATION_TARGET_LANG]: targetLang })
      })
  }, [])

  return (
    <ThemeProvider theme={currentTheme}>
      <Container
        maxWidth='sm'
        sx={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Typography
          variant='h5'
          component='div'
          gutterBottom
          sx={{
            display: 'flex',
            flexDirection: 'row',
            pt: 2,
          }}
        >
          {title}
          <Typography
            variant='caption'
            component='div'
            gutterBottom
            sx={{ pl: '6px' }}
          >
            {version}
          </Typography>
        </Typography>
        <Typography
          variant='body1'
          component='div'
          gutterBottom
        >
          {t('slogan').toString()}
        </Typography>
        <List
          sx={{
            marginLeft: '-16px',
            marginRight: '-16px',
          }}
        >
          {/* We could disable this if the user hasn't made a payment yet,
          but they likely have since they're on the options page.
          Plus there is nothing too bad about always showing this button. */}
          <ListItem disablePadding divider>
            <ListItemButton
              component='button'
              type='button'
              onClick={() => {
                browser.runtime.sendMessage({
                  type: MessageType.OPEN_EXTPAY_MANAGEMENT_PAGE,
                } as Message)
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {t('manage_subscription').toString()}
                </ListItemText>
                <span className="material-symbols-outlined">open_in_new</span>
              </Box>
            </ListItemButton>
          </ListItem>
          {/* <ListItem
            divider
            disablePadding
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              pt: '8px',
              pb: '8px',
              pl: '16px',
              pr: '9px', // trick.
            }}
          >
            <ListItemText>
              {t('openai').toString()}
            </ListItemText>
            <TextField
              hiddenLabel
              size='small'
              sx={{
                width: '180px',
                height: '32px',
              }}
              inputProps={{
                type: 'password',
                placeholder: t('optional').toString(),
                style: {
                  paddingTop: '4px',
                  paddingBottom: '4px',
                },
              }}
              value={openAiApiKey}
              onChange={({ target: { value = '' } = {} }) => {
                // Don't useEffect for `openAiApiKey` here.
                browser.storage.sync.set({ [Settings.OPENAI_API_KEY]: value.trim() })
                setOpenAiApiKey(value)
              }}
            />
          </ListItem> */}
          <ListItem
            divider
            disablePadding
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              pt: '3px', // trick.
              pb: '3px', // trick.
              pl: '16px',
              pr: '8px',
            }}
          >
            <ListItemText>
              {t('copy_with_timestamps').toString()}
            </ListItemText>
            <Checkbox
              checked={copyWithTimestamps}
              onChange={({ target: { checked } }) => {
                // Don't useEffect for `copyWithTimestamps` here.
                browser.storage.sync.set({ [Settings.COPY_WITH_TIMESTAMPS]: checked })
                setCopyWithTimestamps(checked)
              }}
            />
          </ListItem>
          {/* <ListItem disablePadding divider>
            <ListItemButton
              component='a'
              href='https://twitter.com/mth_li'
              target='_blank'
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {t('twitter').toString()}
                </ListItemText>
                <span className="material-symbols-outlined">open_in_new</span>
              </Box>
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding divider>
            <ListItemButton
              component='a'
              href='https://t.me/betteryoutubesummary'
              target='_blank'
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {t('telegram').toString()}
                </ListItemText>
                <span className="material-symbols-outlined">open_in_new</span>
              </Box>
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding divider>
            <ListItemButton
              component='a'
              href={`mailto:matthewlee0725@gmail.com?subject=${`${title} ${version}`}`}
              target='_blank'
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {t('gmail').toString()}
                </ListItemText>
                <span className="material-symbols-outlined">open_in_new</span>
              </Box>
            </ListItemButton>
          </ListItem> */}
          <ListItem disablePadding>
            <ListItemButton
              component='a'
              href='https://github.com/WofWca/better-youtube-summary-extension'
              target='_blank'
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <ListItemText>
                  {t('source_code').toString()}
                </ListItemText>
                <span className="material-symbols-outlined">open_in_new</span>
              </Box>
            </ListItemButton>
          </ListItem>
        </List>
      </Container>
    </ThemeProvider>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <CssBaseline />
    <App />
  </React.StrictMode>
)
