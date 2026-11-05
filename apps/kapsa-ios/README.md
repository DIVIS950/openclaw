# Kapsa for iPhone (SwiftUI)

A real iPhone app version of Kapsa: loyalty cards, gift cards, coupons and promo codes
that pop up by themselves when you walk into the shop.

- **Wallet:** colourful cards stacked like a real wallet, each with its shop logo. The
  card of the shop you're in shows big at the top, with its barcode ready to scan.
- **Scan:** Apple's live barcode scanner, a code from a photo, or type the number.
- **Gift cards:** money left on the card, "Pay" takes it off (with Undo), hidden PIN,
  a reminder two weeks before it expires.
- **Promo codes and coupons:** add a code to any card; in the shop it shows under the
  card with a Copy button.
- **Stamps and points:** +1 stamp, reward with confetti, points goal.
- **2-minute reminder:** after a few minutes in a shop where you have a card, a
  notification says "show your card". It works even when Kapsa is closed: iOS watches
  your saved shop places and wakes the app (needs location set to **Always**).
- **Spending:** log what you spend, monthly chart, where the money goes.
- Czech or English (follows the iPhone's language). Everything stays on the phone.

Needs **iOS 17 or newer**.

## Option A: Xcode on a Mac (recommended, everything works)

1. Install **Xcode** from the Mac App Store.
2. Xcode → **File → New → Project… → iOS → App** → Next.
   - Product Name: `Kapsa`
   - Interface: **SwiftUI**, Language: **Swift**, Storage: **None**
3. In the left file list, delete the two files Xcode made (`ContentView.swift` and
   `KapsaApp.swift`) → **Move to Trash**.
4. **File → New → File… → Swift File**, name it `Kapsa.swift`, and paste the whole of
   [`Kapsa-AllInOne.swift`](Kapsa-AllInOne.swift) into it.
5. Click the blue **Kapsa** project at the top of the file list → target **Kapsa** →
   **Info** tab → hover a row → **+** and add these three (the text is what the iPhone
   shows when it asks):

   | Key | Value |
   |---|---|
   | Privacy - Camera Usage Description | Kapsa scans the barcode on your card. |
   | Privacy - Location When In Use Usage Description | Kapsa shows the card of the shop you are in. |
   | Privacy - Location Always and When In Use Usage Description | Kapsa reminds you to use your card in the shop, even when it is closed. |

6. **General** tab → **Minimum Deployments** → iOS **17.0**.
7. Plug in your iPhone, pick it at the top of Xcode, press **▶**.
   - First time: on the iPhone turn on **Settings → Privacy & Security → Developer Mode**.
   - Xcode asks to sign: **Signing & Capabilities → Team → Add an Account** (your normal
     Apple ID is enough). With a free Apple ID the app runs for 7 days, then press ▶
     again. A paid Apple Developer account ($99 a year) removes that limit and lets you
     put it on the App Store.
   - If the iPhone says "Untrusted Developer": **Settings → General → VPN & Device
     Management** → your Apple ID → **Trust**.

### If Xcode shows errors

- **Build Settings → Swift Language Version → Swift 5** (the code is written for it).
- Newer Xcode: **Build Settings → Default Actor Isolation → nonisolated** if you see
  many "main actor" errors.
- Still errors? Copy the first red error and send it to me; I'll fix it.

## Option B: Swift Playgrounds (iPad or Mac, no Xcode)

1. Open **Swift Playgrounds** → **+ App**.
2. Delete the files it made (`MyApp.swift`, `ContentView.swift`).
3. **+** → new Swift file → paste the whole of `Kapsa-AllInOne.swift`.
4. **App Settings → Capabilities → +**: add **Camera** and **Location (When In Use)**.
5. Run. The 2-minute reminder works while the app is open; with the app closed it needs
   "Always" location, which only the Xcode version can ask for.

## Files

- `Kapsa/*.swift`: the source, one file per part (edit these).
- `Kapsa-AllInOne.swift`: the same code in one file to paste. Rebuild it with
  `python3 apps/kapsa-ios/make-allinone.py` after changing the source.
