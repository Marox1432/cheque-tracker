# Cheque Tracker app

An installable app for iPhone and laptop. It shows your post-dated cheques with countdowns,
and sends a notification 5 days and 1 day before each cheque date (and on the day).

Your cheque data is never stored in this repository. The app reads your Google Sheet through a
link that stays on your devices and in GitHub secrets.

## 1. Turn on the app address

The files and the daily alert job are already in this repository. Go to **Settings, Pages**,
choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and Save. After about a minute your
app is at `https://marox1432.github.io/cheque-tracker/`.

## 2. Publish your sheet as a CSV link

In Google Sheets: **File, Share, Publish to web**. On the Link tab choose the
**Cheque Tracker** tab and **Comma-separated values (.csv)**, press **Publish**, and copy the link.
Anyone who has this link can read the sheet, so keep it private.

## 3. Install on your iPhone

1. Open your app address in **Safari**. Tap **Share, Add to Home Screen**.
2. Open the app **from the new icon** (notifications only work from the icon).
3. Open **Setup and alerts**. Paste the sheet link and tap **Save link**. Your cheques appear.
4. Tap **Create alert keys**. Two boxes appear. Keep this screen open for the next step.
5. Tap **Turn on notifications here** and allow them. A device line appears.

## 4. Give GitHub the secrets

In your repository open **Settings, Secrets and variables, Actions, New repository secret**
and add four secrets (the name must match exactly):

| Name | Value |
| --- | --- |
| `SHEET_CSV_URL` | the sheet link from step 2 |
| `VAPID_PUBLIC_KEY` | the public key from the app |
| `VAPID_PRIVATE_KEY` | the private key from the app |
| `PUSH_SUBSCRIPTIONS` | the device line from the app |

## 5. Test it

Open the **Actions** tab, choose **Cheque alerts**, press **Run workflow**, tick
**Send a test notification** and run it. Your phone should buzz within a minute.

## 6. Add your laptop

Open the app address in Chrome or Edge and install it (the install icon in the address bar).
In **Setup and alerts** paste the sheet link, **paste the same public key** into the Public key box
(do not create new keys), and tap **Turn on notifications here**. Copy the device line and add it as a
**new line** under the existing text in the `PUSH_SUBSCRIPTIONS` secret. One device per line.

## Good to know

- Alerts run every day at 08:55 Dubai time. GitHub can start the job a few minutes late.
- GitHub pauses scheduled jobs in a repository with no activity for 60 days. If that happens,
  open the Actions tab and press **Enable**.
- If a device stops receiving alerts, open the app, tap **Turn on notifications here** again and replace
  that device's line in `PUSH_SUBSCRIPTIONS`.
- Cancelled cheques (Remarks contains "Cancelled") are skipped.
- The job log shows only counts, never payee names or amounts.
