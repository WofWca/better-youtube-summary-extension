The intended "trial" logic is like this:

1. The user presses the "summarize button" for the first time
2. Try to obtain the user's email from the email page
3. If we found the user's email, register a trial for that email, and give the
    user 5 trial usages
4. If we couldn't obtain the email from the page, open the extensionpay.com's
    "start trial" page.
5. When the user provides the email, we register a trial
    for this email on our server.

We _do not_ use the `trialStartedAt` property from ExtPay.
This is for historical reasons as previously we did use it,
but now for the purposes of registering a trial
we're just using ExtPay to obtain the user's email.

Why need a server? So that reinstalling the extension doesn't reset the trial.
