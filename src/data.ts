export interface Chapter {
  cid: string,
  vid: string,
  slicer: string,
  style: ChapterStyle,
  start: number,
  lang: string,
  chapter: string,
  summary?: string,
}

export enum ChapterStyle {
  MARKDOWN = 'markdown',
  TEXT = 'text',
}

export interface Message {
  type: MessageType,
  requestUrl?: string,
  requestInit?: RequestInit,
  responseOk?: boolean,
  responseJson?: any,
  sseEvent?: string,
  sseData?: any,
  error?: Error,
}

export enum MessageType {
  REQUEST = 'request',
  RESPONSE = 'response',
  SSE = 'sse',
  ERROR = 'error',
}

export interface PageChapter {
  title: string,
  timestamp: string,
}

export enum Settings {
  UID = 'uid',
  OPENAI_API_KEY = 'openai_api_key',
  TRANSLATION_TARGET_LANG = 'translation_target_lang',
  COPY_WITH_TIMESTAMPS = 'copy_with_timestamps',
  PAYMENT_STATUS = 'payment_status',

  // TODO refactor: remove these from storage, if the extension has been
  // updated from a previous version?
  // DAILY_LIMIT_USES_LEFT = 'daily_limit_uses_left',
  // DAILY_LIMIT_RESET_TIME = 'daily_limit_reset_time',
}

export enum PaymentStatusType {
  NOT_PAID_BUT_CAN_ACTIVATE_TRIAL = 'not_paid_but_can_activate_trial',
  /**
   * This state is also assumed when subscription is canceled / expired,
   * even if the user skipped trial and paid right away.
   * `usesLeft` will be 0 in such a case.
   */
  NOT_PAID_BUT_TRIAL_ALREADY_STARTED = 'not_paid_but_trial_already_started',
  PAID = 'paid',
}
export type PaymentStatus = {
  type: Exclude<PaymentStatusType, PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED>
} | {
  type: PaymentStatusType.NOT_PAID_BUT_TRIAL_ALREADY_STARTED,
  // This could be 0, which also means that the trial has been used up
  usesLeft: number
}

export const initialTrialUsageLimit = 5;

export enum SseEvent {
  SUMMARY = 'summary',
  CLOSE = 'close',
}

export enum State {
  NOTHING = 'nothing',
  DOING = 'doing',
  DONE = 'done',
}

export interface Summary {
  state: State,
  chapters?: Chapter[],
  video_summary?: string,
}

// https://en.wikipedia.org/wiki/Languages_used_on_the_Internet#Internet_users_by_language
export enum TargetLang {
  'en' = 'English', // default.
  'zh' = '中文',
  'es' = 'Español',
  'id' = 'Bahasa Indonesia',
  'pt' = 'Português',
  'fr' = 'Français',
  'ja' = '日本語',
  'ru' = 'Русский язык',
  'de' = 'Deutsch',
  'ko' = '한국어',
}

export interface Translation {
  vid: string,
  cid: string,
  lang: string,
  chapter: string,
  summary: string,
}
