import browser from 'webextension-polyfill'
import { MessageType } from "./data";
import log from './log';

const TAG = 'extensionpayContentScript'

// TODO refactor: maybe add MutationObserver in case the website gets
// updated so that the input is no longer there on initial load.
const getEmialInput: () => null | HTMLInputElement
  = () => document.querySelector('input[type="email"]');

const responseP = browser.runtime.sendMessage({
  type: MessageType.EMAIL_REQUEST
})
responseP.then((email: null | string) => {
  log(TAG, `Response from background, ${email}`)
  if (!email) {
    return
  }
  // Sanity check, just to make sure that the background script didn't
  // send us anything super private by mistake and we don't end up
  // injecting something like a password into the page.
  if (!email.endsWith('@gmail.com')) {
    log(TAG, 'Error: response sanity check failed, bailing')
    return
  }

  const input = getEmialInput()
  if (!input) {
    log(TAG, 'Warn: no email input found')
    return;
  }

  if (input.value.length > 0) {
    // TODO perf: we could avoid making the email request at all,
    // if this is the case.
    log(TAG, 'Email input is not empty. Refusing to override it')
    return
  }

  input.value = email
})
