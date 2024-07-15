import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

const resources = {
  en: {
    translation: {
      'title': 'YouTube Video Summarizer',
      'slogan': '',

      'translation': 'Set Translation Language',
      'openai': 'I want to use my OpenAI API Key',
      'copy_with_timestamps': 'Copy with Timestamps',
      'twitter': 'Follow on Twitter',
      'telegram': 'Join Telegram Group',
      'gmail': 'Feedback by Email',
      'source_code': 'Source Code',

      'bad': 'Bad',
      'close': 'Close',
      'copy': 'Copy',
      'good': 'Good',
      'more': 'More',
      'optional': 'Optional',
      'settings': 'Settings',
      'summarize': 'Summarize',
      'sync_to_video_time': 'Sync to Video Time',
      'translate': 'Translate',
      'unfold_less': 'Unfold Less',

      'no_transcript': 'No Subtitles',
      'no_transcript_desc': 'This video cannot be summarized at this time, as no subtitles were found 👀',
    },
  },
  zh: {
    translation: {
      'title': 'YouTube Video Summarizer',
      'slogan': '字面意义上更好的 YouTube 摘要插件 🎯',

      'translation': '设置翻译语言',
      'openai': '我想用自己的 OpenAI API Key',
      'copy_with_timestamps': '复制时间标记',
      'twitter': '在推特上关注',
      'telegram': '加入电报群组',
      'gmail': '通过邮件反馈',

      'bad': '糟糕',
      'close': '关闭',
      'copy': '复制',
      'good': '不错',
      'more': '更多',
      'optional': '可选',
      'settings': '设置',
      'summarize': '摘要',
      'sync_to_video_time': '与视频时间同步',
      'translate': '翻译',
      'unfold_less': '折叠',

      'no_transcript': '没有字幕',
      'no_transcript_desc': '这个视频目前没有摘要，因为没有找到字幕 👀',
    },
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',

    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
