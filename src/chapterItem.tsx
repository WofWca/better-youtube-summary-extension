import React, { useState } from 'react'
import useResizeObserver from 'use-resize-observer'

import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'

import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

import { Chapter } from './data'
import './i18n'
import theme from './theme'

const formatSeconds = (seconds: number): string => {
  const pad = (num: number, size: number): string => ('000' + num).slice(size * -1)

  const h = Math.floor(seconds / 60 / 60)
  const m = Math.floor(seconds / 60) % 60
  const s = Math.floor(seconds % 60)

  let res = pad(m, (h > 0 || m >= 10) ? 2 : 1) + ':' + pad(s, 2)
  if (h > 0) res = pad(h, h >= 10 ? 2 : 1) + ':' + res
  return res
}

// https://stackoverflow.com/a/8488787
const countLines = (str?: string | null): number => {
  return str ? str.trim().split(/\r\n|\r|\n/).length : 0
}

const hexToRgba = (hex: string, alpha: number = 1) => {
  // @ts-ignore
  const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16))
  return `rgba(${r},${g},${b},${alpha})`
}

const ChapterItem = ({ seconds, chapter, summary = '' }: Chapter) => {
  const [expand, setExpand] = useState(false)
  const { ref, width = 0 } = useResizeObserver<HTMLDivElement>()
  const count = countLines(summary)

  return (
    <>
      <ListItem
        disablePadding
        secondaryAction={
          <Button
            component='div'
            size='small'
            ref={ref}
            sx={{
              minWidth: 0,
              paddingLeft: '8px',
              paddingRight: '8px',
            }}
            onClick={() => {
              // TODO
            }}
          >
            {formatSeconds(seconds)}
          </Button>
        }
      >
        <ListItemButton
          disabled={count <= 0}
          onClick={() => setExpand(!expand)}
        >
          <ListItemText
            primaryTypographyProps={{
              sx: {
                fontWeight: expand ? 600 : 400,
              }
            }}
            style={{ paddingRight: `${width}px` }}
          >
            {chapter}
            <Typography
              variant='body1'
              style={{
                display: 'inline',
                color: hexToRgba(theme.palette.text.primary, 0.3),
              }}
            >
              &nbsp;&nbsp;{count}
            </Typography>
          </ListItemText>
        </ListItemButton>
      </ListItem>
      <Collapse in={expand} timeout='auto' unmountOnExit>
        <ReactMarkdown className='markdown-body' rehypePlugins={[rehypeRaw]}>
          {/* textVide(summary) */ summary}
        </ReactMarkdown>
        <Divider light />
      </Collapse>
    </>
  )
}

export default ChapterItem
