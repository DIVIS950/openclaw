# Put the app on your iPad with TestFlight (no Mac needed)

A Mac in the cloud (GitHub Actions) builds the app and sends it to Apple's **TestFlight**. You then install it on the iPad with the free TestFlight app. New versions arrive the same way.

You do steps 1–6 once. It takes about an hour, plus Apple's wait for step 1.

## 1. Join the Apple Developer Program

- Go to developer.apple.com/programs and enroll with your Apple ID. It costs **US$99 per year**.
- Apple can take from a few hours to two days to approve you.

## 2. Find your Team ID

- On developer.apple.com, sign in and open **Account › Membership details**.
- Copy the **Team ID**. It is 10 letters and numbers, like `A1B2C3D4E5`.

## 3. Choose the app's ID (bundle ID) and register it

- Pick an ID that is yours, written backwards like a web address, for example `com.yourname.homecontrol`.
- On developer.apple.com: **Certificates, IDs & Profiles › Identifiers › +** › **App IDs** › **App**.
- Description: `Home Control`. Bundle ID: **Explicit**, then type your ID. Click **Continue › Register**.

## 4. Create the app in App Store Connect

- Go to appstoreconnect.apple.com › **Apps › + › New App**.
- Platform **iOS**, name **Home Control** (any name you like; if it is taken, add your name), language, and the bundle ID from step 3.
- SKU: anything, for example `homecontrol1`. User access: **Full Access**.
- The app is **not** published in the App Store. TestFlight is private.

## 5. Make an App Store Connect key

This lets the cloud Mac sign and upload the app for you.

- In App Store Connect: **Users and Access › Integrations › App Store Connect API › Team Keys**, then **+**.
- Name: `GitHub build`. Access: **Admin**. Admin is needed so the cloud Mac can make the signing certificate.
- Click **Generate**, then **Download API Key**. You get a file named `AuthKey_XXXXXXXXXX.p8`. You can download it **only once**, so keep it safe.
- On the same page, copy the **Key ID** (next to the key) and the **Issuer ID** (at the top).

## 6. Put the 5 values in GitHub

- On github.com, open this repository › **Settings › Secrets and variables › Actions › New repository secret**.
- Add these 5 secrets (name on the left, value on the right):

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | the Team ID from step 2 |
| `BUNDLE_ID` | the bundle ID from step 3 |
| `ASC_KEY_ID` | the Key ID from step 5 |
| `ASC_ISSUER_ID` | the Issuer ID from step 5 |
| `ASC_KEY_P8` | the whole text of the `.p8` file (open it with TextEdit or Notepad and copy everything, including the BEGIN and END lines) |

GitHub keeps secrets hidden. Nobody can read them back, not even you.

- If the **Actions** tab says workflows are turned off (common on a fork), click the green button to turn them on.

## 7. Build and send the app

- Open the **Actions** tab › **Home Control iPad app** › **Run workflow** (leave "Also send the app to TestFlight" ticked) › **Run workflow**.
- It takes about 15–25 minutes. A green tick means the app was sent to Apple.
- Apple then checks the build for 5–30 minutes. You get an email when it is ready.

## 8. Install it on the iPad

- In App Store Connect › your app › **TestFlight › Internal Testing › +**, make a group (for example "Family"), and add yourself (and anyone else in your team).
- On the iPad, install **TestFlight** from the App Store and sign in with the same Apple ID.
- Open the invite (email or the TestFlight app) and tap **Install**. The app appears on the Home Screen as **Home**.
- TestFlight builds last 90 days. Run step 7 again to get a fresh build (or a newer version) any time.

## If something goes wrong

- **The build fails with Swift errors:** the app was written without a Mac, so the first cloud builds may show errors. The log of every run is under **Actions**. Send me the errors and I fix them.
- **"These repository secrets are missing":** check the 5 names in step 6. They must match exactly.
- **Signing or "no profiles" errors:** check that the bundle ID in GitHub is exactly the one registered in step 3, and that the key has **Admin** access.
- **The build does not show up in TestFlight:** check your email. Apple sometimes asks a question about the app first.

Every push to the app's code also runs a quick **compile check** (no Apple account needed). It shows whether the app still builds.
